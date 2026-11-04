/**
 * Pub/sub for live updates. In-process EventEmitter by default; replace with
 * Redis/NATS when running multiple instances behind a load balancer.
 */
import { EventEmitter } from 'node:events';

export interface LiveUpdate {
  type: 'ball' | 'toss' | 'innings_end' | 'match_end';
  matchId: string;
  at: string;
  data: unknown;
}

export interface PubSub {
  publish(u: LiveUpdate): void;
  subscribe(topic: string, fn: (u: LiveUpdate) => void): () => void;
}

export class LocalHub implements PubSub {
  private ee = new EventEmitter().setMaxListeners(0);
  publish(u: LiveUpdate) {
    this.ee.emit(`match:${u.matchId}`, u);
    this.ee.emit('all', u);
  }
  subscribe(topic: string, fn: (u: LiveUpdate) => void) {
    this.ee.on(topic, fn);
    return () => { this.ee.off(topic, fn); };
  }
}
