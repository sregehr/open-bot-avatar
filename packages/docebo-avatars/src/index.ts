/**
 * Docebo agent avatars as a micro front end. Loading this file registers two custom elements,
 * <docebo-agent-avatar> and <docebo-avatar-picker>; the same things are exported for hosts that
 * would rather drive them from code.
 */
import { defineDoceboAvatars } from './elements.ts';

export { AVATARS, DEFAULT_COLOR, SETS, STONE, eyeColorFor, getAvatar } from './avatars.ts';
export type { AvatarSet, DoceboAvatar } from './avatars.ts';
export { DoceboAgentAvatar, DoceboAvatarPicker, defineDoceboAvatars } from './elements.ts';
export type { AvatarChangeDetail } from './elements.ts';
export { renderAvatarSvg, validateAvatar } from 'open-bot-avatar';
export type { AvatarDefinition, AvatarMood, AvatarState } from 'open-bot-avatar';
export { mountAvatar } from 'open-bot-avatar/dom';

defineDoceboAvatars();
