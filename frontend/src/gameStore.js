import { writable } from 'svelte/store';

export const localPlayer = writable(null);
export const players = writable(new Map());
export const phase = writable('lobby');   // 'lobby' | 'playing'
export const myRole = writable(null);       // 'alien' | 'resident' | null
export const messages = writable([])