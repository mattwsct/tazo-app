import { NextRequest, NextResponse } from 'next/server';
import { getSubGoalServer } from '@/lib/sub-goal-server';
import { OverlayLogger } from '@/lib/logger';
import crypto from 'crypto';
import { Buffer } from 'buffer';

// Updated interface to match Kick.com webhook payload structure
interface KickWebhookEvent {
  broadcaster: {
    user_id: number;
    username: string;
    channel_slug: string;
  };
  subscriber?: {
    user_id: number;
    username: string;
    channel_slug: string;
  };
  gifter?: {
    user_id: number;
    username: string;
    channel_slug: string;
  };
  giftees?: Array<{
    user_id: number;
    username: string;
    channel_slug: string;
  }>;
  is_live?: boolean;
  title?: string;
  started_at?: string;
  ended_at?: string;
  duration?: number;
  created_at?: string;
  expires_at?: string;
}

// Kick public key (from docs)
const KICK_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq/+l1WnlRrGSolDMA+A8\n6rAhMbQGmQ2SapVcGM3zq8ANXjnhDWocMqfWcTd95btDydITa10kDvHzw9WQOqp2\nMZI7ZyrfzJuz5nhTPCiJwTwnEtWft7nV14BYRDHvlfqPUaZ+1KR4OCaO/wWIk/rQ\nL/TjY0M70gse8rlBkbo2a8rKhu69RQTRsoaf4DVhDPEeSeI5jVrRDGAMGL3cGuyY\n6CLKGdjVEM78g3JfYOvDU/RvfqD7L89TZ3iN94jrmWdGz34JNlEI5hqK8dd7C5EF\nBEbZ5jgB8s8ReQV8H+MkuffjdAj3ajDDX3DOJMIut1lBrUVD1AaSrGCKHooWoL2e\ntwIDAQAB\n-----END PUBLIC KEY-----`;

function verifyKickSignature(req: NextRequest, rawBody: Buffer): boolean {
  const messageId = req.headers.get('Kick-Event-Message-Id');
  const timestamp = req.headers.get('Kick-Event-Message-Timestamp');
  const signatureB64 = req.headers.get('Kick-Event-Signature');
  if (!messageId || !timestamp || !signatureB64) return false;
  const signatureInput = `${messageId}.${timestamp}.${rawBody.toString()}`;
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(signatureInput);
  verifier.end();
  const pubKey = KICK_PUBLIC_KEY;
  const signature = Buffer.from(signatureB64, 'base64');
  return verifier.verify(pubKey, signature);
}

/**
 * Kick.com webhook receiver for real subscription and stream events
 * Based on official Kick.com webhook documentation
 */
export async function POST(request: NextRequest) {
  try {
    // Read raw body for signature verification
    const rawBody = Buffer.from(await request.text());
    const headers = Object.fromEntries(request.headers.entries());
    let signatureValid = false;
    try {
      signatureValid = verifyKickSignature(request, rawBody);
    } catch (err) {
      OverlayLogger.error('[KICK WEBHOOK] Signature verification error', { error: err });
    }
    if (!signatureValid) {
      OverlayLogger.error('[KICK WEBHOOK] ❌ Invalid signature', {
        headers,
        rawBody: rawBody.toString()
      });
      return NextResponse.json({ success: false, error: 'Invalid signature' }, { status: 401 });
    }
    // Parse JSON as before
    const body = JSON.parse(rawBody.toString());
    const event: KickWebhookEvent = body;
    const eventType = request.headers.get('Kick-Event-Type');
    
    OverlayLogger.overlay(`[KICK WEBHOOK] ✅ Valid signature. Event: ${eventType}, Broadcaster: ${event.broadcaster?.username || 'N/A'}`);

    const subGoalServer = getSubGoalServer();
    const channel = event.broadcaster?.username || 'Tazo'; // Use broadcaster username
    
    // Create channel if it doesn't exist
    let subGoalData = subGoalServer.getSubGoalData(channel);
    if (!subGoalData) {
      OverlayLogger.overlay('Creating new channel for webhook', { channel });
      subGoalServer.handleStreamEvent(channel, 'stream_start');
      subGoalData = subGoalServer.getSubGoalData(channel);
      
      if (!subGoalData) {
        OverlayLogger.error('Failed to create channel data', { channel });
        return NextResponse.json({ success: false, error: 'Failed to create channel' }, { status: 500 });
      }
    }

    // Handle different event types based on Kick.com documentation
    switch (eventType) {
      case 'livestream.status.updated':
        if (event.is_live) {
          // Stream started
          subGoalServer.handleStreamEvent(channel, 'stream_start');
          OverlayLogger.overlay('Stream started via Kick webhook', { 
            channel, 
            title: event.title,
            startedAt: event.started_at
          });
        } else {
          // Stream ended
          subGoalServer.handleStreamEvent(channel, 'stream_stop');
          OverlayLogger.overlay('Stream ended via Kick webhook', { 
            channel, 
            title: event.title,
            endedAt: event.ended_at
          });
        }
        break;

      case 'channel.subscription.new':
        // New subscription
        subGoalData.currentSubs += 1;
        subGoalData.latestSub = {
          type: 'subscription',
          username: event.subscriber?.username || 'Unknown',
          months: event.duration || 1,
          timestamp: event.created_at ? new Date(event.created_at).getTime() : Date.now()
        };
        subGoalData.lastSubTime = event.created_at ? new Date(event.created_at).getTime() : Date.now();
        
        OverlayLogger.overlay('New subscription received', {
          username: event.subscriber?.username,
          duration: event.duration,
          currentSubs: subGoalData.currentSubs,
          goal: subGoalData.currentGoal
        });
        break;

      case 'channel.subscription.renewal':
        // Subscription renewal
        subGoalData.currentSubs += 1;
        subGoalData.latestSub = {
          type: 'resub',
          username: event.subscriber?.username || 'Unknown',
          months: event.duration || 1,
          timestamp: event.created_at ? new Date(event.created_at).getTime() : Date.now()
        };
        subGoalData.lastSubTime = event.created_at ? new Date(event.created_at).getTime() : Date.now();
        
        OverlayLogger.overlay('Subscription renewal received', {
          username: event.subscriber?.username,
          duration: event.duration,
          currentSubs: subGoalData.currentSubs,
          goal: subGoalData.currentGoal
        });
        break;

      case 'channel.subscription.gifts':
        // Gift subscriptions
        const giftCount = event.giftees?.length || 1;
        subGoalData.currentSubs += giftCount;
        subGoalData.latestSub = {
          type: 'gift',
          username: event.gifter?.username || 'Anonymous',
          giftCount,
          timestamp: event.created_at ? new Date(event.created_at).getTime() : Date.now()
        };
        subGoalData.lastSubTime = event.created_at ? new Date(event.created_at).getTime() : Date.now();
        
        OverlayLogger.overlay('Gift subscriptions received', {
          gifter: event.gifter?.username || 'Anonymous',
          giftCount,
          giftees: event.giftees?.map(g => g.username),
          currentSubs: subGoalData.currentSubs,
          goal: subGoalData.currentGoal
        });
        break;

      default:
        OverlayLogger.overlay('Unhandled Kick.com event - please check documentation', { 
          eventType,
          fullEvent: event,
          channel 
        });
        return NextResponse.json({ 
          success: false, 
          error: 'Unhandled event type',
          receivedEvent: eventType 
        }, { status: 400 });
    }

    // Update server data and broadcast to all connected clients
    subGoalServer.updateSubGoalData(channel, subGoalData);

    return NextResponse.json({ 
      success: true, 
      message: 'Webhook processed',
      currentSubs: subGoalData.currentSubs,
      goal: subGoalData.currentGoal
    });

  } catch (error) {
    OverlayLogger.error('Error processing Kick.com webhook:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to process webhook' 
    }, { status: 500 });
  }
}

/**
 * GET endpoint for webhook verification
 */
export async function GET() {
  return NextResponse.json({ 
    success: true, 
    message: 'Kick.com webhook endpoint is active',
    timestamp: new Date().toISOString()
  });
} 