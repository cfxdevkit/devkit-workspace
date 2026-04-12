import type { Server as IOServer } from 'socket.io';
import type { NodeManager } from './node-manager.js';

/**
 * WebSocket layer
 *
 * Pushes real-time node events to all connected browser clients:
 *   - "node:status"   every 2 s — { server, mining, rpcUrls, accounts }
 *   - "node:started"  when the node transitions to running
 *   - "node:stopped"  when the node stops
 */
export function setupWebSocket(io: IOServer, nodeManager: NodeManager): void {
  let statusInterval: ReturnType<typeof setInterval> | null = null;
  let wasRunning = false;

  function broadcastStatus() {
    const manager = nodeManager.getManager();

    if (!manager) {
      io.emit('node:status', {
        server: 'stopped',
        mining: null,
        rpcUrls: null,
        accounts: 0,
      });
      if (wasRunning) {
        io.emit('node:stopped', {});
        wasRunning = false;
      }
      return;
    }

    const status = manager.getNodeStatus();
    io.emit('node:status', status);

    if (!wasRunning && status.server === 'running') {
      io.emit('node:started', status);
      wasRunning = true;
    } else if (wasRunning && status.server !== 'running') {
      io.emit('node:stopped', {});
      wasRunning = false;
    }
  }

  io.on('connection', (socket) => {
    // Send current status immediately on connect
    broadcastStatus();

    socket.on('disconnect', () => {
      // nothing to clean up per-socket
    });
  });

  // Broadcast status to all clients every 2 s
  statusInterval = setInterval(broadcastStatus, 2000);

  // Clean up on server close
  io.engine.on('close', () => {
    if (statusInterval) {
      clearInterval(statusInterval);
      statusInterval = null;
    }
  });
}
