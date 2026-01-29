import { useEffect, useRef, useState, useCallback } from 'react';
import { HeartRateLogger } from '@/lib/logger';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useAnimatedValue } from '@/hooks/useAnimatedValue';
import { HEART_RATE_ANIMATION } from '@/utils/overlay-constants';

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
  ANIMATION_DELAY: 1000, // 1 second delay before updating animation speed
  MAX_RECONNECT_ATTEMPTS: 10,
  CONNECTION_DEBOUNCE: 30000, // 30 seconds - optimal for IRL streams with brief connection drops (tunnels, rural areas)
  COLOR_DEBOUNCE: 5000, // 5 seconds - debounce color changes to prevent rapid flashing
} as const;

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
  const [stableAnimationBpm, setStableAnimationBpm] = useState(0);
  const [debouncedBpm, setDebouncedBpm] = useState(0); // Debounced BPM for color calculation
  
  // Use animated value hook for smooth BPM transitions - counts through each integer (70, 71, 72...)
  const smoothHeartRate = useAnimatedValue(
    heartRate.isConnected && heartRate.bpm > 0 ? heartRate.bpm : null,
    {
      ...HEART_RATE_ANIMATION,
      allowNull: true,
    }
  ) ?? 0;
  
  // Refs for managing timeouts
  const heartRateTimer = useRef<NodeJS.Timeout | null>(null);
  const animationTimer = useRef<NodeJS.Timeout | null>(null);
  const connectionTimer = useRef<NodeJS.Timeout | null>(null);
  const colorDebounceTimer = useRef<NodeJS.Timeout | null>(null);
  const currentBpmRef = useRef(0);

  // === 💗 DEBOUNCED CONNECTION STATE UPDATE ===
  const updateConnectionState = useCallback((isConnected: boolean) => {
    // Clear any existing debounce timeout
    if (connectionTimer.current) {
      clearTimeout(connectionTimer.current);
      connectionTimer.current = null;
    }

    // If connecting, update immediately
    if (isConnected) {
      setHeartRate(prev => ({ ...prev, isConnected: true }));
      return;
    }

    // If disconnecting, debounce to prevent rapid flashing
    connectionTimer.current = setTimeout(() => {
      setHeartRate(prev => ({ ...prev, isConnected: false }));
      connectionTimer.current = null;
    }, HEART_RATE_CONFIG.CONNECTION_DEBOUNCE);
  }, []);

  // === 💗 DEBOUNCED BPM FOR COLOR CALCULATION ===
  useEffect(() => {
    if (heartRate.bpm > 0 && heartRate.isConnected) {
      // Clear any existing color debounce timer
      if (colorDebounceTimer.current) {
        clearTimeout(colorDebounceTimer.current);
      }
      
      // Debounce BPM updates for color calculation (5-10 seconds)
      colorDebounceTimer.current = setTimeout(() => {
        setDebouncedBpm(heartRate.bpm);
      }, HEART_RATE_CONFIG.COLOR_DEBOUNCE);
      
      return () => {
        if (colorDebounceTimer.current) {
          clearTimeout(colorDebounceTimer.current);
        }
      };
    } else {
      // Reset debounced BPM when disconnected
      setDebouncedBpm(0);
    }
  }, [heartRate.bpm, heartRate.isConnected]);

  // === 💗 SMOOTH HEART RATE TRANSITIONS ===
  useEffect(() => {
    if (heartRate.bpm > 0 && heartRate.isConnected) {
      // Clear any existing timeout since we have fresh data
      if (heartRateTimer.current) {
        clearTimeout(heartRateTimer.current);
        heartRateTimer.current = null;
      }
      
      // Update animation BPM with a delay to prevent abrupt changes
      if (animationTimer.current) {
        clearTimeout(animationTimer.current);
      }
      
      // Only update animation speed if the change is significant
      const bpmDifference = Math.abs(heartRate.bpm - stableAnimationBpm);
      if (bpmDifference > HEART_RATE_CONFIG.CHANGE_THRESHOLD || stableAnimationBpm === 0) {
        animationTimer.current = setTimeout(() => {
          setStableAnimationBpm(heartRate.bpm);
        }, HEART_RATE_CONFIG.ANIMATION_DELAY);
      }
      
      // Set timeout to hide heart rate if no new data after timeout period
      heartRateTimer.current = setTimeout(() => {
        HeartRateLogger.info('Heart rate data timeout - hiding monitor');
        updateConnectionState(false);
        setHeartRate(prev => ({ ...prev, bpm: 0 }));
        setStableAnimationBpm(0);
        setDebouncedBpm(0);
      }, HEART_RATE_CONFIG.TIMEOUT);
    } else if (!heartRate.isConnected && heartRate.bpm > 0) {
      // Connection lost - immediately clear heart rate data
      HeartRateLogger.info('Heart rate connection lost - hiding monitor');
      setHeartRate(prev => ({ ...prev, bpm: 0 }));
      setStableAnimationBpm(0);
      setDebouncedBpm(0);
      
      // Clear any existing timeouts
      if (heartRateTimer.current) {
        clearTimeout(heartRateTimer.current);
        heartRateTimer.current = null;
      }
      if (animationTimer.current) {
        clearTimeout(animationTimer.current);
        animationTimer.current = null;
      }
      if (colorDebounceTimer.current) {
        clearTimeout(colorDebounceTimer.current);
        colorDebounceTimer.current = null;
      }
    }
  }, [heartRate.bpm, heartRate.isConnected, stableAnimationBpm, updateConnectionState]);

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
          
          // Immediately clear heart rate data when connection is lost
          setHeartRate(prev => ({ ...prev, bpm: 0, isConnected: false }));
          setStableAnimationBpm(0);
          
          // Clear any existing timeouts
          if (heartRateTimer.current) {
            clearTimeout(heartRateTimer.current);
            heartRateTimer.current = null;
          }
          if (animationTimer.current) {
            clearTimeout(animationTimer.current);
            animationTimer.current = null;
          }
          
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
        
        pulsoidSocket.onerror = (event) => {
          if (isDestroyed) return;
          
          // Extract meaningful error information from the Event object
          const errorInfo: Record<string, unknown> = {
            type: event.type,
            isTrusted: event.isTrusted,
            readyState: pulsoidSocket?.readyState,
          };
          
          // Try to extract more details if available
          if (event instanceof ErrorEvent) {
            errorInfo.message = event.message;
            errorInfo.filename = event.filename;
            errorInfo.lineno = event.lineno;
            errorInfo.colno = event.colno;
          }
          
          // Only log significant errors, not connection interruptions during normal operation
          // Connection interruptions during page reload are normal and don't need error logging
          const isSignificantError = pulsoidSocket?.readyState === WebSocket.CLOSED && 
                                     event.type === 'error' &&
                                     !event.isTrusted; // Browser-triggered errors are usually interruptions
          
          if (isSignificantError) {
            HeartRateLogger.error('Pulsoid WebSocket connection error', errorInfo);
          } else {
            // Log as info for normal connection interruptions
            HeartRateLogger.info('Pulsoid WebSocket connection interrupted (will reconnect)', {
              readyState: pulsoidSocket?.readyState
            });
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
      
      if (heartRateTimer.current) {
        clearTimeout(heartRateTimer.current);
        heartRateTimer.current = null;
      }
      
      if (animationTimer.current) {
        clearTimeout(animationTimer.current);
        animationTimer.current = null;
      }
      
      if (connectionTimer.current) {
        clearTimeout(connectionTimer.current);
        connectionTimer.current = null;
      }
      
      if (colorDebounceTimer.current) {
        clearTimeout(colorDebounceTimer.current);
        colorDebounceTimer.current = null;
      }
    };
      }, [pulsoidToken, onConnected, updateConnectionState]); // Include onConnected dependency

  // Don't render if not connected or no BPM data
  if (!heartRate.isConnected || heartRate.bpm <= 0) {
    return null;
  }

  // Get current heart rate
  const currentBpm = Math.round(smoothHeartRate || heartRate.bpm);
  
  // Calculate color based on debounced BPM (only for numbers, not heart icon)
  // Use debouncedBpm if available, otherwise use currentBpm for initial display
  const bpmForColor = debouncedBpm > 0 ? debouncedBpm : currentBpm;
  let textColor: string;
  if (bpmForColor < 95) {
    textColor = '#FFFFFF'; // White
  } else if (bpmForColor >= 95 && bpmForColor <= 115) {
    textColor = '#FF8888'; // Light red
  } else {
    textColor = '#FF4444'; // Red (same as heart icon)
  }
  
  // Use white text shadow for high heartrate (darker red) to improve readability
  // against dark backgrounds and real-world content
  const textShadow = textColor === '#FF4444' 
    ? '0 0 4px rgba(255, 255, 255, 0.6), 0 1px 2px rgba(255, 255, 255, 0.4)'
    : undefined; // Use default CSS text-shadow for other colors

  return (
    <ErrorBoundary>
      <div className="heart-rate-wrapper">
        <div className="heart-rate">
          <div className="heart-rate-content">
            {/* Heart icon - always red (same as high heart rate color) */}
            <div 
              className="heart-rate-icon beating"
              style={{
                animationDuration: stableAnimationBpm > 0 ? `${60 / stableAnimationBpm}s` : '1s',
                color: '#FF4444' // Always red, consistent with high heart rate text color
              }}
            >
              <svg 
                width="24" 
                height="24" 
                viewBox="0 0 24 24" 
                fill="currentColor"
              >
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
              </svg>
            </div>
            {/* Numbers - color changes based on BPM */}
            <div className="heart-rate-text">
              <span 
                className="heart-rate-value"
                style={{
                  color: textColor,
                  textShadow: textShadow,
                  transition: 'color 0.5s ease-in-out, text-shadow 0.5s ease-in-out' // Smooth color and shadow transitions
                }}
              >
                {currentBpm}
              </span>
            </div>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
} 