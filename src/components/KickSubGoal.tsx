"use client";

import { useState, useEffect, useCallback } from 'react';
import { OverlayLogger } from '@/lib/logger';


interface KickSubGoalProps {
  channelName: string;
  dailyGoal: number;
  isVisible: boolean;
  showLatestSub?: boolean;
  showLeaderboard?: boolean;
  enableRollingSubGoal?: boolean;
  rollingSubGoalIncrement?: number;
  subGoalData?: {
    currentSubs?: number;
    latestSub?: string | null;
    lastUpdate?: number;
  } | null;

}

interface KickEvent {
  type: 'subscription' | 'gift' | 'resub';
  username: string;
  months?: number;
  giftCount?: number;
  timestamp: number;
}

interface SubLeaderboardEntry {
  username: string;
  totalSubs: number;
  lastSubTime: number;
  isGiftSub: boolean;
}

interface PersistedSubData {
  currentSubs: number;
  currentGoal: number;
  lastResetDate: string;
  recentEvents: KickEvent[];
  latestSub: KickEvent | null;
  subLeaderboard: SubLeaderboardEntry[];
  goalReachedTime: number | null;
  lastSubTime: number | null;
  streamEndTime: number | null; // Track when stream ended
  isStreamActive: boolean; // Track stream status
}

export default function KickSubGoal({ 
  channelName, 
  dailyGoal, 
  isVisible, 
  showLatestSub = false,
  showLeaderboard = false,
  enableRollingSubGoal = false,
  rollingSubGoalIncrement = 5,
  subGoalData,
}: KickSubGoalProps) {
  const [currentSubs, setCurrentSubs] = useState(0);
  const [currentGoal, setCurrentGoal] = useState(dailyGoal);
  const [recentEvents, setRecentEvents] = useState<KickEvent[]>([]);
  const [latestSub, setLatestSub] = useState<KickEvent | null>(null);
  const [subLeaderboard, setSubLeaderboard] = useState<SubLeaderboardEntry[]>([]);
  const [lastResetDate, setLastResetDate] = useState<string>('');
  const [goalReachedTime, setGoalReachedTime] = useState<number | null>(null);
  const [lastSubTime, setLastSubTime] = useState<number | null>(null);
  const [isStreamActive, setIsStreamActive] = useState(false);
  const [streamEndTime, setStreamEndTime] = useState<number | null>(null);

  // Storage key for persistence
  const storageKey = `kick_sub_goal_${channelName}`;

    // Load persisted data on component mount
  useEffect(() => {
    if (!channelName) return;

    try {
      const persisted = localStorage.getItem(storageKey);
      if (persisted) {
        const data: PersistedSubData = JSON.parse(persisted);
        
        // Restore data from storage
        setCurrentSubs(data.currentSubs);
        setCurrentGoal(data.currentGoal);
        setLastResetDate(data.lastResetDate);
        setRecentEvents(data.recentEvents || []);
        setLatestSub(data.latestSub);
        setSubLeaderboard(data.subLeaderboard || []);
        setGoalReachedTime(data.goalReachedTime);
        setLastSubTime(data.lastSubTime);
        setStreamEndTime(data.streamEndTime);
        setIsStreamActive(data.isStreamActive || false);
        
        OverlayLogger.overlay('Restored sub goal data from storage', {
          currentSubs: data.currentSubs,
          currentGoal: data.currentGoal,
          streamActive: data.isStreamActive
        });
      } else {
        // First time, initialize
        const now = new Date().toISOString();
        setLastResetDate(now);
        setCurrentGoal(dailyGoal);
        setIsStreamActive(false);
        
        OverlayLogger.overlay('Initialized new sub goal tracking', {
          dailyGoal,
          resetDate: now
        });
      }
    } catch (error) {
      OverlayLogger.error('Error loading persisted sub goal data', error);
      // Fallback to fresh start - reset manually
      const now = new Date().toISOString();
      setLastResetDate(now);
      setCurrentGoal(dailyGoal);
      setCurrentSubs(0);
      setRecentEvents([]);
      setLatestSub(null);
      setSubLeaderboard([]);
      setGoalReachedTime(null);
      setLastSubTime(null);
      setStreamEndTime(null);
      setIsStreamActive(false);
    }
  }, [channelName, dailyGoal, storageKey]);

  // Update currentGoal when dailyGoal prop changes
  useEffect(() => {
    setCurrentGoal(dailyGoal);
  }, [dailyGoal]);

  // Save data to localStorage whenever it changes
  const saveToStorage = useCallback(() => {
    if (!channelName) return;

    try {
      const data: PersistedSubData = {
        currentSubs,
        currentGoal,
        lastResetDate,
        recentEvents,
        latestSub,
        subLeaderboard,
        goalReachedTime,
        lastSubTime,
        streamEndTime,
        isStreamActive
      };
      
      localStorage.setItem(storageKey, JSON.stringify(data));
    } catch (error) {
      OverlayLogger.error('Error saving sub goal data to storage', error);
    }
  }, [channelName, currentSubs, currentGoal, lastResetDate, recentEvents, latestSub, subLeaderboard, goalReachedTime, lastSubTime, streamEndTime, isStreamActive, storageKey]);

  // Save data whenever relevant state changes
  useEffect(() => {
    saveToStorage();
  }, [currentSubs, currentGoal, lastResetDate, recentEvents, latestSub, subLeaderboard, goalReachedTime, lastSubTime, streamEndTime, isStreamActive, saveToStorage]);

  // Rolling sub goal logic
  useEffect(() => {
    if (!enableRollingSubGoal) return;

    const checkRollingGoal = () => {
      const now = Date.now();
      const isCurrentlyReached = currentSubs >= currentGoal;
      
      if (isCurrentlyReached) {
        if (!goalReachedTime) {
          // Goal just reached, start timer
          setGoalReachedTime(now);
          OverlayLogger.overlay('Sub goal reached! Starting rolling goal timer', { 
            currentSubs, 
            currentGoal, 
            delay: 5 
          });
        } else {
          // Goal is still reached, check if we should reset timer
          if (lastSubTime && (now - lastSubTime) < 30000) { // If last sub was within 30 seconds, reset timer
            setGoalReachedTime(now);
            OverlayLogger.overlay('Rolling goal timer reset due to new subs', { 
              currentSubs, 
              currentGoal, 
              delay: 5,
              timeSinceLastSub: now - lastSubTime
            });
          }
        }
      } else if (goalReachedTime && (now - goalReachedTime) >= (5 * 60 * 1000)) {
        // Timer expired, calculate next goal as multiple of increment
        const nextGoal = Math.ceil(currentSubs / rollingSubGoalIncrement) * rollingSubGoalIncrement;
        setCurrentGoal(nextGoal);
        setGoalReachedTime(null);
        OverlayLogger.overlay('Rolling sub goal increased', { 
          oldGoal: currentGoal, 
          newGoal: nextGoal, 
          currentSubs,
          increment: rollingSubGoalIncrement,
          calculation: `Math.ceil(${currentSubs} / ${rollingSubGoalIncrement}) * ${rollingSubGoalIncrement} = ${nextGoal}`
        });
      }
    };

    checkRollingGoal();
    
    // Check every 30 seconds for rolling goal updates
    const rollingGoalInterval = setInterval(checkRollingGoal, 30 * 1000);
    
    return () => clearInterval(rollingGoalInterval);
  }, [enableRollingSubGoal, currentSubs, currentGoal, goalReachedTime, rollingSubGoalIncrement, lastSubTime]);

  // Handle sub goal data from parent (SSE updates)
  useEffect(() => {
    if (subGoalData) {
      // Update sub count if provided
      if (subGoalData.currentSubs !== undefined) {
        setCurrentSubs(subGoalData.currentSubs);
      }
      
      // Update latest sub if provided
      if (subGoalData.latestSub !== undefined) {
        setLatestSub(subGoalData.latestSub ? {
          type: 'subscription',
          username: subGoalData.latestSub,
          timestamp: subGoalData.lastUpdate || Date.now()
        } : null);
      }
    }
  }, [subGoalData]);

  // Use prop values for display when available
  const displaySubs = subGoalData?.currentSubs !== undefined ? subGoalData.currentSubs : currentSubs;
  const displayLatestSub = subGoalData?.latestSub !== undefined ? 
    (subGoalData.latestSub ? {
      type: 'subscription' as const,
      username: subGoalData.latestSub,
      timestamp: subGoalData.lastUpdate || Date.now()
    } : null) : latestSub;



  // Note: Kick.com webhook and events stream endpoints were removed during cleanup
  // This component now only displays static data for demonstration purposes
  useEffect(() => {
    if (!isVisible || !channelName) return;

    // For now, we'll just simulate some connection status
    // setIsConnected(false); // This line was removed as per the edit hint
    
    OverlayLogger.overlay('Kick.com integration disabled - endpoints removed during cleanup', { channelName });
  }, [isVisible, channelName]);





  const progressPercentage = Math.min((displaySubs / currentGoal) * 100, 100);
  const isGoalReached = displaySubs >= currentGoal;

  if (!isVisible) return null;



  return (
    <div className="kick-sub-goal">
      <div className="kick-sub-goal-container">
        {/* Sub Leaderboard - Now at the top */}
        {showLeaderboard && (
          <div className="kick-leaderboard">
            <div className="leaderboard-title">Top Gift Subs</div>
            {subLeaderboard.length > 0 ? (
              <div className="leaderboard-list">
                {subLeaderboard.map((entry, index) => (
                  <div key={entry.username} className="leaderboard-entry">
                    <span className="leaderboard-rank">#{index + 1}</span>
                    <span className="leaderboard-username">{entry.username}</span>
                    <span className="leaderboard-subs">{entry.totalSubs}</span>
                    {entry.isGiftSub && <span className="leaderboard-gift">🎁</span>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="leaderboard-list">
                <div className="leaderboard-entry" style={{ opacity: 0.5 }}>
                  <span className="leaderboard-rank">#1</span>
                  <span className="leaderboard-username">No gift subs yet</span>
                  <span className="leaderboard-subs">0</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Latest Sub Display - Now in the middle */}
        {showLatestSub && (
          <div className={`kick-latest-sub ${showLeaderboard ? 'with-border' : ''}`}>
            <div className="latest-sub-title">Latest Sub</div>
            {displayLatestSub ? (
              <div className="latest-sub-content">
                <span className="latest-sub-username">{displayLatestSub.username}</span>
                {displayLatestSub.type === 'gift' && displayLatestSub.giftCount && displayLatestSub.giftCount > 1 && (
                  <span className="latest-sub-count">x{displayLatestSub.giftCount}</span>
                )}
              </div>
            ) : (
              <div className="latest-sub-content" style={{ opacity: 0.5 }}>
                <span className="latest-sub-username">Waiting for subs...</span>
              </div>
            )}
          </div>
        )}

        {/* Sub Goal - Now at the bottom with updated title */}
        <div className={`kick-sub-goal-section ${(showLeaderboard || showLatestSub) ? 'with-border' : ''}`}>
          <div className="kick-sub-goal-header">
            <div className="kick-sub-goal-title">
              <span className="kick-text">Sub Goal</span>
            </div>
          </div>
          
          <div className="kick-sub-goal-progress">
            <div className="progress-bar">
              <div 
                className={`progress-fill ${isGoalReached ? 'goal-reached' : ''}`}
                style={{ width: `${progressPercentage}%` }}
              >
                {displaySubs}/{currentGoal}
              </div>
            </div>
          </div>
        </div>

        {recentEvents.length > 0 && !showLatestSub && !showLeaderboard && (
          <div className="kick-recent-events">
            <div className="recent-events-title">Recent Activity</div>
            <div className="recent-events-list">
              {recentEvents.slice(0, 3).map((event, index) => (
                <div key={index} className="recent-event">
                  <span className="event-type">
                    {event.type === 'subscription' ? '🔴' : 
                     event.type === 'resub' ? '🟡' : '🎁'}
                  </span>
                  <span className="event-username">{event.username}</span>
                  {event.type === 'gift' && event.giftCount && event.giftCount > 1 && (
                    <span className="gift-count">x{event.giftCount}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Removed goal celebration text to maintain regular design */}
      </div>
    </div>
  );
}