interface PortalsPlayer {
  id: string;
  playerId: string | null;
  displayName: string;
  avatarUrl: string;
}

interface PortalsSession {
  self: PortalsPlayer;
  players: PortalsPlayer[];
  state: Record<string, unknown>;
}

interface PortalsNet {
  join(options?: { channel?: string }): Promise<PortalsSession>;
  leave(): void;
  send(data: unknown): void;
  players(): PortalsPlayer[];
  self(): PortalsPlayer | null;
  getState(key?: string): unknown;
  setState(key: string, value: unknown): void;
  on(event: "message", handler: (data: unknown, fromId: string) => void): void;
  on(
    event: "playerjoin" | "playerleave",
    handler: (player: PortalsPlayer, players: PortalsPlayer[]) => void,
  ): void;
  on(event: "status", handler: (status: string) => void): void;
  off(event: string, handler: (...args: never[]) => void): void;
}

interface Window {
  Portals?: {
    net: PortalsNet;
  };
}
