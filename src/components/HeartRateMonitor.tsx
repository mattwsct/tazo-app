import { useEffect, useRef, useState, useCallback } from 'react';
import { HeartRateLogger } from '@/lib/logger';
import { ErrorBoundary } from '@/components/ErrorBoundary';

// === 💗 HEART RATE TYPES & CONSTANTS ===
interface PulsoidHeartRateData {
  measured_at: number;
  data: {
    heart_rate: number;
  };
}

interface HeartRateState {
  bpm: number;
  lastUpdate: number;
  isConnected: boolean;
}

const HEART_RATE_CONFIG = {
  TIMEOUT: 30000, // 30 seconds - hide if no data (more forgiving for IRL streaming)
  CHANGE_THRESHOLD: 5, // 5 BPM - minimum change to update animation
  TRANSITION_STEPS: 20, // Number of smooth transition steps
  STEP_DURATION: 100, // ms per step (2 seconds total)
  ANIMATION_DELAY: 1000, // 1 second delay before updating animation speed
  MAX_RECONNECT_ATTEMPTS: 10,
  CONNECTION_DEBOUNCE: 30000, // 30 seconds - optimal for IRL streams with brief connection drops (tunnels, rural areas)
} as const;



// Heart rate zones and color mapping
const HEART_RATE_ZONES = {
  NEUTRAL: { min: 0, max: 40, color: '#808080', name: 'Neutral' },       // Gray (neutral/error state)
  RESTING: { min: 40, max: 60, color: '#87CEEB', name: 'Resting' },      // Light blue
  NORMAL: { min: 60, max: 100, color: '#FFFFFF', name: 'Normal' },       // White
  ELEVATED: { min: 100, max: 120, color: '#FFFF99', name: 'Elevated' },  // Light yellow
  HIGH: { min: 120, max: 140, color: '#FFA500', name: 'High' },          // Orange
  VERY_HIGH: { min: 140, max: 200, color: '#FF0000', name: 'Very High' }, // Red
} as const;

// Function to get heart rate zone and color
function getHeartRateZone(bpm: number) {
  if (bpm < HEART_RATE_ZONES.NEUTRAL.max) return HEART_RATE_ZONES.NEUTRAL;
  if (bpm < HEART_RATE_ZONES.RESTING.max) return HEART_RATE_ZONES.RESTING;
  if (bpm < HEART_RATE_ZONES.NORMAL.max) return HEART_RATE_ZONES.NORMAL;
  if (bpm < HEART_RATE_ZONES.ELEVATED.max) return HEART_RATE_ZONES.ELEVATED;
  if (bpm < HEART_RATE_ZONES.HIGH.max) return HEART_RATE_ZONES.HIGH;
  return HEART_RATE_ZONES.VERY_HIGH;
}



// === 💗 HEART RATE MONITOR COMPONENT ===
interface HeartRateMonitorProps {
  pulsoidToken?: string;
  onConnected?: () => void;
  onVisibilityChange?: (isVisible: boolean) => void;
}

export default function HeartRateMonitor({ pulsoidToken, onConnected, onVisibilityChange }: HeartRateMonitorProps) {
  // Heart rate state
  const [heartRate, setHeartRate] = useState<HeartRateState>({
    bpm: 0,
    lastUpdate: 0,
    isConnected: false,
  });
  const [smoothHeartRate, setSmoothHeartRate] = useState(0);
  const [stableAnimationBpm, setStableAnimationBpm] = useState(0);
  
  // Refs for managing timeouts
  const heartRateTimeout = useRef<NodeJS.Timeout | null>(null);
  const animationUpdateTimeout = useRef<NodeJS.Timeout | null>(null);
  const connectionDebounceTimeout = useRef<NodeJS.Timeout | null>(null);
  const currentBpmRef = useRef(0);

  // === 💗 DEBOUNCED CONNECTION STATE UPDATE ===
  const updateConnectionState = useCallback((isConnected: boolean) => {
    // Clear any existing debounce timeout
    if (connectionDebounceTimeout.current) {
      clearTimeout(connectionDebounceTimeout.current);
      connectionDebounceTimeout.current = null;
    }

    // If connecting, update immediately
    if (isConnected) {
      setHeartRate(prev => ({ ...prev, isConnected: true }));
      return;
    }

    // If disconnecting, debounce to prevent rapid flashing
    connectionDebounceTimeout.current = setTimeout(() => {
      setHeartRate(prev => ({ ...prev, isConnected: false }));
      connectionDebounceTimeout.current = null;
    }, HEART_RATE_CONFIG.CONNECTION_DEBOUNCE);
  }, []);

  // === 💗 SMOOTH HEART RATE TRANSITIONS ===
  useEffect(() => {
    if (heartRate.bpm > 0 && heartRate.isConnected) {
      // Clear any existing timeout since we have fresh data
      if (heartRateTimeout.current) {
        clearTimeout(heartRateTimeout.current);
        heartRateTimeout.current = null;
      }
      
      // Smoothly transition to new BPM over 2 seconds
      const currentBpm = smoothHeartRate || heartRate.bpm;
      const targetBpm = heartRate.bpm;
      const steps = HEART_RATE_CONFIG.TRANSITION_STEPS;
      const stepSize = (targetBpm - currentBpm) / steps;
      const stepDuration = HEART_RATE_CONFIG.STEP_DURATION;
      
      let step = 0;
      const transitionInterval = setInterval(() => {
        step++;
        const newBpm = currentBpm + (stepSize * step);
        setSmoothHeartRate(newBpm);
        
        if (step >= steps) {
          clearInterval(transitionInterval);
          setSmoothHeartRate(targetBpm);
        }
      }, stepDuration);
      
      // Update animation BPM with a delay to prevent abrupt changes
      if (animationUpdateTimeout.current) {
        clearTimeout(animationUpdateTimeout.current);
      }
      
      // Only update animation speed if the change is significant
      const bpmDifference = Math.abs(targetBpm - stableAnimationBpm);
      if (bpmDifference > HEART_RATE_CONFIG.CHANGE_THRESHOLD || stableAnimationBpm === 0) {
        animationUpdateTimeout.current = setTimeout(() => {
          setStableAnimationBpm(targetBpm);
        }, HEART_RATE_CONFIG.ANIMATION_DELAY);
      }
      
      // Set timeout to hide heart rate if no new data after 5 seconds
      heartRateTimeout.current = setTimeout(() => {
        HeartRateLogger.info('Heart rate data timeout - hiding monitor');
        updateConnectionState(false);
        setHeartRate(prev => ({ ...prev, bpm: 0 }));
        setSmoothHeartRate(0);
        setStableAnimationBpm(0);
      }, HEART_RATE_CONFIG.TIMEOUT);
      
      return () => {
        clearInterval(transitionInterval);
      };
    } else if (!heartRate.isConnected && heartRate.bpm > 0) {
      // Connection lost - immediately clear heart rate data
      HeartRateLogger.info('Heart rate connection lost - hiding monitor');
      setHeartRate(prev => ({ ...prev, bpm: 0 }));
      setSmoothHeartRate(0);
      setStableAnimationBpm(0);
      
      // Clear any existing timeouts
      if (heartRateTimeout.current) {
        clearTimeout(heartRateTimeout.current);
        heartRateTimeout.current = null;
      }
      if (animationUpdateTimeout.current) {
        clearTimeout(animationUpdateTimeout.current);
        animationUpdateTimeout.current = null;
      }
    }
  }, [heartRate.bpm, heartRate.isConnected, smoothHeartRate, stableAnimationBpm, updateConnectionState]);

  // === 💗 PULSOID WEBSOCKET CONNECTION ===
  useEffect(() => {
    let pulsoidSocket: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;
    let reconnectAttempts = 0;
    let isConnecting = false;
    let isDestroyed = false;
    
    function connectPulsoid() {
      if (!pulsoidToken) {
        HeartRateLogger.info('Pulsoid token not provided, skipping heart rate integration');
        return;
      }
      
      // Prevent multiple simultaneous connection attempts
      if (isConnecting || (pulsoidSocket && pulsoidSocket.readyState === WebSocket.CONNECTING)) {
        return;
      }
      
      // Don't connect if component is being destroyed
      if (isDestroyed) {
        return;
      }
      
      isConnecting = true;
      
      try {
        const wsUrl = `wss://dev.pulsoid.net/api/v1/data/real_time?access_token=${pulsoidToken}`;
        pulsoidSocket = new WebSocket(wsUrl);
        
        pulsoidSocket.onopen = () => {
          if (isDestroyed) {
            pulsoidSocket?.close();
            return;
          }
          
          HeartRateLogger.info('Pulsoid WebSocket connected successfully');
          updateConnectionState(true);
          onConnected?.();
          reconnectAttempts = 0;
          isConnecting = false;
        };
        
        pulsoidSocket.onmessage = (event) => {
          if (isDestroyed) return;
          
          try {
            const data: PulsoidHeartRateData = JSON.parse(event.data);
            if (data.data && typeof data.data.heart_rate === 'number') {
              const newBpm = data.data.heart_rate;
              
              // Only log if BPM changed significantly (more than 2 BPM difference)
              const currentBpm = currentBpmRef.current;
              if (Math.abs(newBpm - currentBpm) > 2) {
                HeartRateLogger.info(`Heart rate changed: ${currentBpm} → ${newBpm} BPM`);
              }
              
              // Update the ref
              currentBpmRef.current = newBpm;
              
              setHeartRate({
                bpm: newBpm,
                lastUpdate: data.measured_at,
                isConnected: true,
              });
            }
          } catch (error) {
            HeartRateLogger.error('Failed to parse Pulsoid data:', error);
          }
        };
        
        pulsoidSocket.onclose = () => {
          if (isDestroyed) return;
          
          HeartRateLogger.info('Pulsoid WebSocket connection closed');
          updateConnectionState(false);
          isConnecting = false;
          
          // Auto-reconnect with exponential backoff (only if not destroyed)
          if (!isDestroyed && reconnectAttempts < HEART_RATE_CONFIG.MAX_RECONNECT_ATTEMPTS) {
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
            // Add minimum 2 second delay to prevent rapid reconnection
            const finalDelay = Math.max(delay, 2000);
            HeartRateLogger.info(`Reconnecting to Pulsoid in ${finalDelay}ms (attempt ${reconnectAttempts + 1})`);
            reconnectTimeout = setTimeout(() => {
              if (!isDestroyed) {
                reconnectAttempts++;
                connectPulsoid();
              }
            }, finalDelay);
          } else if (reconnectAttempts >= HEART_RATE_CONFIG.MAX_RECONNECT_ATTEMPTS) {
            HeartRateLogger.error('Max reconnection attempts reached, giving up');
          }
        };
        
        pulsoidSocket.onerror = (error) => {
          if (isDestroyed) return;
          
          // Only log significant errors, not connection interruptions
          if (pulsoidSocket?.readyState === WebSocket.CLOSED || 
              pulsoidSocket?.readyState === WebSocket.CLOSING) {
            HeartRateLogger.error('Pulsoid WebSocket connection error:', error);
          }
          isConnecting = false;
        };
        
      } catch (error) {
        HeartRateLogger.error('Failed to connect to Pulsoid:', error);
        isConnecting = false;
      }
    }
    
    // Start connection with a delay to stagger with other WebSocket connections
    const initTimeout = setTimeout(() => {
      connectPulsoid();
    }, 500); // 500ms delay to let other connections establish first
    
    return () => {
      isDestroyed = true;
      isConnecting = false;
      
      // Clear the initialization timeout
      clearTimeout(initTimeout);
      
      if (pulsoidSocket) {
        pulsoidSocket.close();
        pulsoidSocket = null;
      }
      
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
      
      if (heartRateTimeout.current) {
        clearTimeout(heartRateTimeout.current);
        heartRateTimeout.current = null;
      }
      
      if (animationUpdateTimeout.current) {
        clearTimeout(animationUpdateTimeout.current);
        animationUpdateTimeout.current = null;
      }
      
      if (connectionDebounceTimeout.current) {
        clearTimeout(connectionDebounceTimeout.current);
        connectionDebounceTimeout.current = null;
      }
    };
      }, [pulsoidToken, onConnected, updateConnectionState]); // Include onConnected dependency

  // Notify parent about visibility changes
  useEffect(() => {
    const isVisible = heartRate.isConnected && heartRate.bpm > 0;
    onVisibilityChange?.(isVisible);
  }, [heartRate.isConnected, heartRate.bpm, onVisibilityChange]);

  // Don't render if not connected or no BPM data
  if (!heartRate.isConnected || heartRate.bpm <= 0) {
    return null;
  }

  // Get current heart rate zone and color
  const currentBpm = Math.round(smoothHeartRate || heartRate.bpm);
  const heartRateZone = getHeartRateZone(currentBpm);
  
  // Log zone changes (only when zone actually changes)
  const previousZone = getHeartRateZone(Math.round(smoothHeartRate || 0));
  if (previousZone.name !== heartRateZone.name && currentBpm > 0) {
    HeartRateLogger.info(`Heart rate zone changed: ${previousZone.name} → ${heartRateZone.name} (${currentBpm} BPM)`);
  }

  return (
    <ErrorBoundary>
      <div className="heart-rate">
      <div className="heart-rate-content">
        <div 
          className="heart-rate-icon beating"
          style={{
            animationDuration: stableAnimationBpm > 0 ? `${60 / stableAnimationBpm}s` : '1s'
          }}
        >
          💓
        </div>
        <div className="heart-rate-text">
          <span 
            className="heart-rate-value"
            style={{ 
              color: heartRateZone.color,
              textShadow: `0 0 8px ${heartRateZone.color}40, 1px 1px 3px rgba(0, 0, 0, 0.8)`
            }}
          >
            {currentBpm}
          </span>
          <span className="heart-rate-label">BPM</span>
        </div>
      </div>
    </div>
    </ErrorBoundary>
  );
} 