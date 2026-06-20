import { writable } from 'svelte/store';

export const localPlayer = writable(null);
export const players = writable(new Map());
