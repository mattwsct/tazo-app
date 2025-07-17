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

// Heart rate color calculation based on BPM ranges
function getHeartRateColors(bpm: number) {
  if (bpm <= 0) {
    return {
      background: 'linear-gradient(135deg, rgba(20, 20, 30, 0.4) 0%, rgba(30, 30, 40, 0.4) 100%)',
      description: 'Disconnected'
    };
  } else if (bpm <= 60) {
    return {
      background: 'linear-gradient(135deg, rgba(30, 40, 60, 0.4) 0%, rgba(40, 50, 70, 0.4) 100%)',
      description: 'Resting'
    };
  } else if (bpm <= 100) {
    return {
      background: 'linear-gradient(135deg, rgba(40, 40, 60, 0.4) 0%, rgba(60, 50, 70, 0.4) 100%)',
      description: 'Normal'
    };
  } else if (bpm <= 120) {
    return {
      background: 'linear-gradient(135deg, rgba(60, 40, 50, 0.4) 0%, rgba(80, 50, 60, 0.4) 100%)',
      description: 'Elevated'
    };
  } else if (bpm <= 140) {
    return {
      background: 'linear-gradient(135deg, rgba(80, 40, 40, 0.4) 0%, rgba(100, 50, 50, 0.4) 100%)',
      description: 'High'
    };
  } else if (bpm <= 160) {
    return {
      background: 'linear-gradient(135deg, rgba(100, 35, 35, 0.4) 0%, rgba(120, 45, 45, 0.4) 100%)',
      description: 'Very High'
    };
  } else {
    return {
      background: 'linear-gradient(135deg, rgba(120, 30, 30, 0.4) 0%, rgba(140, 40, 40, 0.4) 100%)',
      description: 'Maximum'
    };
  }
}

// === 💗 HEART RATE MONITOR COMPONENT ===
interface HeartRateMonitorProps {
  pulsoidToken?: string;
}

export default function HeartRateMonitor({ pulsoidToken }: HeartRateMonitorProps) {
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
    
    function connectPulsoid() {
      if (!pulsoidToken) {
        HeartRateLogger.info('Pulsoid token not provided, skipping heart rate integration');
        return;
      }
      
      try {
        const wsUrl = `wss://dev.pulsoid.net/api/v1/data/real_time?access_token=${pulsoidToken}`;
        pulsoidSocket = new WebSocket(wsUrl);
        
        pulsoidSocket.onopen = () => {
          HeartRateLogger.info('Pulsoid WebSocket connected successfully');
          setHeartRate(prev => ({ ...prev, isConnected: true }));
          reconnectAttempts = 0;
        };
        
        pulsoidSocket.onmessage = (event) => {
          try {
            const data: PulsoidHeartRateData = JSON.parse(event.data);
            if (data.data && typeof data.data.heart_rate === 'number') {
              HeartRateLogger.info(`Heart rate received: ${data.data.heart_rate} BPM`);
              setHeartRate({
                bpm: data.data.heart_rate,
                lastUpdate: data.measured_at,
                isConnected: true,
              });
            }
          } catch (error) {
            HeartRateLogger.error('Failed to parse Pulsoid data:', error);
          }
        };
        
        pulsoidSocket.onclose = () => {
          HeartRateLogger.info('Pulsoid WebSocket connection closed');
          setHeartRate(prev => ({ ...prev, isConnected: false }));
          
          // Auto-reconnect with exponential backoff
          if (reconnectAttempts < HEART_RATE_CONFIG.MAX_RECONNECT_ATTEMPTS) {
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
            HeartRateLogger.info(`Reconnecting to Pulsoid in ${delay}ms (attempt ${reconnectAttempts + 1})`);
            reconnectTimeout = setTimeout(() => {
              reconnectAttempts++;
              connectPulsoid();
            }, delay);
          } else {
            HeartRateLogger.error('Max reconnection attempts reached, giving up');
          }
        };
        
        pulsoidSocket.onerror = (error) => {
          HeartRateLogger.error('Pulsoid WebSocket error:', error);
        };
        
      } catch (error) {
        HeartRateLogger.error('Failed to connect to Pulsoid:', error);
      }
    }
    
    // Start connection
    connectPulsoid();
    
    return () => {
      if (pulsoidSocket) {
        pulsoidSocket.close();
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      if (heartRateTimeout.current) {
        clearTimeout(heartRateTimeout.current);
      }
      if (animationUpdateTimeout.current) {
        clearTimeout(animationUpdateTimeout.current);
      }
    };
  }, [pulsoidToken]);

  // Don't render if not connected or no BPM data
  if (!heartRate.isConnected || heartRate.bpm <= 0) {
    return null;
  }

  const colors = getHeartRateColors(Math.round(smoothHeartRate || heartRate.bpm));

  return (
    <div 
      className="stream-vitals corner-top-left"
      style={{ background: colors.background }}
      title={`Heart Rate: ${colors.description}`}
    >
      <div className="vitals-content">
        <div 
          className="vitals-icon beating"
          style={{
            animationDuration: stableAnimationBpm > 0 ? `${60 / stableAnimationBpm}s` : '1s'
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