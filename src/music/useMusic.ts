import { useContext } from 'react';

import { MusicContext, MusicInterruptionContext } from './MusicProvider';

export function useMusic() {
  const context = useContext(MusicContext);
  if (!context) {
    throw new Error('useMusic must be used inside MusicProvider');
  }
  return context;
}

export function useMusicInterruption() {
  const context = useContext(MusicInterruptionContext);
  if (!context) {
    throw new Error('useMusicInterruption must be used inside MusicProvider');
  }
  return context;
}
