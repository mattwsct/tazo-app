import { useEffect, useRef, useState } from 'react';

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
  TIMEOUT: 30000, // 30 seconds - hide if no data
  CHANGE_THRESHOLD: 5, // 5 BPM - minimum change to update animation
  TRANSITION_STEPS: 20, // Number of smooth transition steps
  STEP_DURATION: 100, // ms per step (2 seconds total)
  ANIMATION_DELAY: 1000, // 1 second delay before updating animation speed
  MAX_RECONNECT_ATTEMPTS: 10,
} as const;

// === 💗 HEART RATE UTILITIES ===
const HeartRateLogger = {
  info: (message: string, data?: unknown) => 
    console.log(`💗 [HEART RATE] ${message}`, data || ''),
  error: (message: string, error?: unknown) => 
    console.error(`💗 [HEART RATE ERROR] ${message}`, error || ''),
} as const;

// Heart rate color calculation based on BPM ranges with dynamic opacity
function getHeartRateColors(bpm: number) {
  if (bpm <= 0) {
    return {
      background: 'linear-gradient(135deg, rgba(20, 20, 30, 0.3) 0%, rgba(30, 30, 40, 0.3) 100%)',
      heartColor: 'rgba(255, 255, 255, 0.7)',
      description: 'Disconnected'
    };
  }
  
  // Threshold: start changing background only above 100 BPM
  const thresholdBpm = 100;
  const maxBpm = 200;
  
  // Clamp BPM to reasonable range
  const clampedBpm = Math.max(0, Math.min(maxBpm, bpm));
  
  // Base background: same as main info card (blue/purple gradient)
  const baseBackground = 'linear-gradient(135deg, rgba(30, 20, 60, 0.65) 0%, rgba(20, 30, 50, 0.65) 50%, rgba(40, 20, 80, 0.65) 100%)';
  
  // If BPM is below threshold, use base background
  if (clampedBpm <= thresholdBpm) {
    return {
      background: baseBackground,
      heartColor: 'rgba(255, 255, 255, 1)',
      description: 'Normal'
    };
  }
  
  // Calculate red intensity and opacity only when above threshold
  const progress = (clampedBpm - thresholdBpm) / (maxBpm - thresholdBpm);
  
  // Opacity: 0.65 (base) to 0.9 (high BPM)
  const opacity = 0.65 + (progress * 0.25);
  
  // Red accent: 0 to 100 additional red
  const redAccent = Math.floor(progress * 100);
  
  // Base colors from main info card
  const baseRed = 30;
  const baseGreen = 20;
  const baseBlue = 60;
  
  const finalRed = baseRed + redAccent;
  const finalGreen = Math.max(0, baseGreen - Math.floor(progress * 10)); // Slight green reduction
  const finalBlue = Math.max(0, baseBlue - Math.floor(progress * 20)); // More blue reduction for redder effect
  
  const background = `linear-gradient(135deg, 
    rgba(${finalRed}, ${finalGreen}, ${finalBlue}, ${opacity}) 0%, 
    rgba(${finalRed + 10}, ${finalGreen + 10}, ${finalBlue + 20}, ${opacity}) 100%)`;
  
  // Heart icon color: white at low BPM, red at high BPM
  const heartRed = Math.floor(255 - (progress * 100)); // 255 to 155
  const heartGreen = Math.floor(255 - (progress * 200)); // 255 to 55
  const heartBlue = Math.floor(255 - (progress * 200)); // 255 to 55
  const heartColor = `rgba(${heartRed}, ${heartGreen}, ${heartBlue}, 1)`;
  
  // Determine description based on BPM ranges
  let description = 'Normal';
  if (bpm <= 60) description = 'Resting';
  else if (bpm <= 100) description = 'Normal';
  else if (bpm <= 120) description = 'Elevated';
  else if (bpm <= 140) description = 'High';
  else if (bpm <= 160) description = 'Very High';
  else description = 'Maximum';
  
  return {
    background,
    heartColor,
    description
  };
}

// === 💗 HEART RATE MONITOR COMPONENT ===
interface HeartRateMonitorProps {
  pulsoidToken?: string;
  onConnected?: () => void;
}

export default function HeartRateMonitor({ pulsoidToken, onConnected }: HeartRateMonitorProps) {
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
  const currentBpmRef = useRef(0);

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
      
      // Set timeout to hide heart rate if no new data after 30 seconds
      heartRateTimeout.current = setTimeout(() => {
        HeartRateLogger.info('Heart rate data timeout - hiding monitor');
        setHeartRate(prev => ({ ...prev, isConnected: false, bpm: 0 }));
        setSmoothHeartRate(0);
        setStableAnimationBpm(0);
      }, HEART_RATE_CONFIG.TIMEOUT);
      
      return () => {
        clearInterval(transitionInterval);
      };
    }
  }, [heartRate.bpm, heartRate.isConnected, smoothHeartRate, stableAnimationBpm]);

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
          setHeartRate(prev => ({ ...prev, isConnected: true }));
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
          setHeartRate(prev => ({ ...prev, isConnected: false }));
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
    };
  }, [pulsoidToken, onConnected]); // Include onConnected dependency

  // Don't render if not connected or no BPM data
  if (!heartRate.isConnected || heartRate.bpm <= 0) {
    return null;
  }

  const colors = getHeartRateColors(Math.round(smoothHeartRate || heartRate.bpm));

  return (
    <div 
      className="stream-vitals corner-top-left"
      style={{ background: colors.background }}
    >
      <div className="vitals-content">
        <div 
          className="vitals-icon beating"
          style={{
            animationDuration: stableAnimationBpm > 0 ? `${60 / stableAnimationBpm}s` : '1s',
            color: colors.heartColor
          }}
        >
          ❤️
        </div>
        <div className="vitals-text">
          <span className="vitals-value">{Math.round(smoothHeartRate || heartRate.bpm)}</span>
          <span className="vitals-label">BPM</span>
        </div>
      </div>
    </div>
  );
} 