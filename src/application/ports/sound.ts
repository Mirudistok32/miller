export type Cue = 'turn' | 'turnBack' | 'blocked' | 'trickle' | 'wheel' | 'unlock';

export interface Sound {
  play(cue: Cue): void;
  setEnabled(on: boolean): void;
}
