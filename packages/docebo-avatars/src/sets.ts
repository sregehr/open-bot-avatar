/**
 * The Docebo avatar sets: which gallery avatars (gallery/<id>.json) belong to Docebo, grouped and
 * in the order they are shown. The editor lists them first; the embeddable elements ship only these.
 */
export interface AvatarSet {
  id: string;
  label: string;
  avatars: string[];
}

export const SETS: AvatarSet[] = [
  { id: 'agents', label: 'Agents', avatars: ['authoring-agent', 'marketplace-agent', 'reinforcement-agent', 'tutor-agent'] },
  {
    id: 'characters',
    label: 'Characters',
    avatars: ['buddy-sphere', 'buddy-cube', 'buddy-hex', 'buddy-gem', 'buddy-pill', 'buddy-drop', 'buddy-waver', 'buddy-cheerer', 'buddy-strider'],
  },
  {
    id: 'elemental',
    label: 'Elemental',
    avatars: [
      'sphere', 'cube', 'gem', 'cone', 'cylinder', 'diamond', 'ring', 'capsule', 'arch', 'dome', 'steps', 'stack', 'cairn', 'ziggurat', 'prism',
      'wedge', 'bowl', 'plus', 'crescent', 'column', 'tile', 'drop', 'tee', 'frustum', 'wave', 'slab', 'crystal', 'hills', 'cluster', 'urn', 'top',
      'mushroom', 'barrel', 'dolmen', 'half', 'quarter',
    ].map((id) => `elemental-${id}`),
  },
  {
    id: 'objects',
    label: 'Objects',
    avatars: [
      'trophy', 'medal', 'badge', 'crown', 'flag', 'flame', 'apple', 'owl', 'pencil', 'bookmark', 'calendar', 'signpost', 'kettlebell', 'pawn',
      'microphone', 'megaphone', 'puzzle', 'heart', 'robot', 'gear', 'plug', 'flask', 'folder', 'bell', 'blob',
    ],
  },
];

/** Every Docebo avatar id, in set order. */
export const DOCEBO_IDS: string[] = SETS.flatMap((set) => set.avatars);
