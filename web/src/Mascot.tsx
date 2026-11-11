import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react';

/**
 * The pack: four soft-3D puppy-bots, one per kind of work the agent does.
 * Which dog is shown, and its face, mirror the live pipeline stage.
 */
export type DogState = 'idle' | 'thinking' | 'searching' | 'remembering' | 'answering' | 'happy' | 'error';
export type Breed = 'biscuit' | 'scout' | 'bones' | 'watch';

export const PACK: Record<Breed, { name: string; job: string }> = {
  biscuit: { name: 'Biscuit', job: 'chats & plans' },
  scout: { name: 'Scout', job: 'searches the web' },
  bones: { name: 'Bones', job: 'digs up memories' },
  watch: { name: 'Watch', job: 'rechecks old answers' },
};

/** Which dog handles a turn, from the agent's tier. */
export function breedForTier(tier?: string): Breed {
  if (tier === 'lookup' || tier === 'research') return 'scout';
  if (tier === 'recall') return 'bones';
  if (tier === 'recheck') return 'watch';
  return 'biscuit';
}

const BUBBLE: Record<DogState, string> = {
  idle: 'Zzz… 💤',
  thinking: 'hmm… 🤔',
  searching: 'sniff sniff 🔍',
  remembering: 'digging… 🦴',
  answering: 'woof, here goes ✍️',
  happy: 'fetched! ✨',
  error: 'ruh-roh 😵',
};

const PET_LINES = ['hehe ❤️', 'more pats pls 🥺', 'good human 🐾', 'wiggle wiggle 💛'];
const SLEEP_AFTER_MS = 6000;
const LOOK_X = 7; // max eye travel, in SVG units
const LOOK_Y = 5;

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Mascot({
  breed,
  state,
  size = 180,
  bubble = true,
  say,
  attention = false,
}: {
  breed: Breed;
  state: DogState;
  size?: number;
  bubble?: boolean;
  /** Overrides the bubble text for this state. */
  say?: string;
  /** The user is typing: wake up and watch the input box. */
  attention?: boolean;
}) {
  const id = useId().replace(/:/g, '');
  const u = (name: string) => `url(#${id}-${name})`;
  const rootRef = useRef<HTMLDivElement>(null);
  const squishRef = useRef<SVGGElement>(null);
  const attentionRef = useRef(attention);
  const [awake, setAwake] = useState(false);
  const [petting, setPetting] = useState(false);
  const [petLine, setPetLine] = useState(PET_LINES.length - 1); // first pat shows line 0
  const [hearts, setHearts] = useState<number[]>([]);
  attentionRef.current = attention;

  // Point the eyes (and, a little, the head) at a spot on screen.
  const aimAt = useCallback((x: number, y: number) => {
    const el = rootRef.current;
    const svg = el?.querySelector('svg');
    if (!el || !svg || reducedMotion()) return;
    const r = svg.getBoundingClientRect();
    const dx = x - (r.left + r.width / 2);
    const dy = y - (r.top + r.height * 0.45);
    const dist = Math.hypot(dx, dy) || 1;
    const reach = Math.min(1, dist / 260); // close to the dog → small movements
    el.style.setProperty('--look-x', `${((dx / dist) * LOOK_X * reach).toFixed(2)}px`);
    el.style.setProperty('--look-y', `${((dy / dist) * LOOK_Y * reach).toFixed(2)}px`);
  }, []);

  // 1. Follow the cursor; wake on movement, doze off after a while.
  useEffect(() => {
    let frame = 0;
    let sleepTimer: ReturnType<typeof setTimeout> | undefined;
    const onMove = (e: PointerEvent) => {
      setAwake(true);
      clearTimeout(sleepTimer);
      sleepTimer = setTimeout(() => setAwake(false), SLEEP_AFTER_MS);
      if (attentionRef.current) return; // watching the input box instead
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => aimAt(e.clientX, e.clientY));
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(frame);
      clearTimeout(sleepTimer);
    };
  }, [aimAt]);

  // 3. While the user types, look at the input box.
  useEffect(() => {
    if (!attention) return;
    const look = () => {
      const box = document.querySelector('.composer textarea')?.getBoundingClientRect();
      if (box) aimAt(box.left + box.width * 0.3, box.top + box.height / 2);
    };
    look();
    const timer = setInterval(look, 300);
    return () => clearInterval(timer);
  }, [attention, aimAt]);

  // 2. Pet the dog: squish, happy face, floating hearts.
  function pet() {
    setPetting(true);
    setPetLine((n) => (n + 1) % PET_LINES.length);
    const heart = Date.now();
    setHearts((h) => [...h.slice(-4), heart]);
    setTimeout(() => setHearts((h) => h.filter((x) => x !== heart)), 1100);
    setTimeout(() => setPetting(false), 900);
    if (!reducedMotion()) {
      squishRef.current?.animate(
        [
          { transform: 'scale(1, 1)' },
          { transform: 'scale(1.14, 0.84)' },
          { transform: 'scale(0.94, 1.08)' },
          { transform: 'scale(1.03, 0.98)' },
          { transform: 'scale(1, 1)' },
        ],
        { duration: 620, easing: 'ease-out' },
      );
    }
  }

  const resting = state === 'idle';
  const watching = resting && (attention || awake);
  const face: FaceKind = petting ? 'happy' : watching ? 'watching' : state;
  const text =
    say ??
    (petting ? PET_LINES[petLine]! : resting && attention ? 'ooh, a question? 👀' : watching ? 'hi! 👋' : BUBBLE[state]);

  return (
    <div
      ref={rootRef}
      className="pet"
      data-state={state}
      data-breed={breed}
      data-attentive={attention || undefined}
      data-awake={watching || undefined}
      style={{ width: size }}
      role="button"
      tabIndex={0}
      aria-label={`Pet ${PACK[breed].name}`}
      title={`Pet ${PACK[breed].name}`}
      onClick={pet}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pet();
        }
      }}
    >
      {bubble && (
        <div className="pet-bubble" key={text} aria-hidden="true">
          {text}
        </div>
      )}
      {hearts.map((h, i) => (
        <span key={h} className="pet-heart" style={{ left: `${38 + ((i * 17) % 30)}%` }} aria-hidden="true">
          ❤️
        </span>
      ))}
      {size >= 80 && <Fx kind={petting ? null : fxFor(breed, state)} />}
      {size >= 80 && (
        <div className="pet-dust" key={breed} aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} style={{ '--i': i } as CSSProperties} />
          ))}
        </div>
      )}
      <svg viewBox="0 0 200 200" width={size} height={size} aria-hidden="true">
        <PetDefs id={id} />
        <ellipse className="pet-ground" cx="100" cy="184" rx="48" ry="8" filter={u('blur')} />

        <g ref={squishRef} className="pet-squish">
          <g className="pet-float" key={breed}>
            <g className="pet-tail">
              <ellipse cx="150" cy="142" rx="9" ry="20" transform="rotate(35 150 142)" fill={u('dark')} filter={u('gummy')} />
            </g>

            {/* body barely moves with the gaze: it is the furthest layer from the viewer's focus */}
            <g className="pet-body">
              <ellipse cx="100" cy="146" rx="46" ry="34" fill={u('body')} filter={u('gummy')} />
              <ellipse cx="86" cy="134" rx="16" ry="7" transform="rotate(-20 86 134)" fill="#fff" opacity="0.35" filter={u('blur')} />
              {/* contact shadows: paws on the ground */}
              <ellipse cx="82" cy="181" rx="13" ry="3.5" fill="#000" opacity="0.18" filter={u('blur')} />
              <ellipse cx="118" cy="181" rx="13" ry="3.5" fill="#000" opacity="0.18" filter={u('blur')} />
              <ellipse cx="82" cy="176" rx="14" ry="8" fill={u('body')} filter={u('gummy')} />
              <ellipse cx="118" cy="176" rx="14" ry="8" fill={u('body')} filter={u('gummy')} />
            </g>
            {/* ambient occlusion where the head sits on the body */}
            <ellipse cx="100" cy="137" rx="38" ry="7" fill="var(--pet-shade)" opacity="0.35" filter={u('blur')} />

            <g className="pet-head">
              <g className="pet-gaze">
                {/* ears sit behind the head, so they lag the turn (parallax) */}
                <g className="pet-ears-layer">
                  <Ears breed={breed} u={u} />
                </g>

                <g className="pet-antenna">
                  <rect x="96.5" y="30" width="7" height="22" rx="3.5" fill={u('dark')} />
                  <circle className="pet-bulb" cx="100" cy="28" r="8" fill={u('bulb')} />
                  <circle cx="97" cy="25" r="2.4" fill="#fff" opacity="0.85" />
                </g>

                <rect x="46" y="48" width="108" height="92" rx="46" fill={u('body')} filter={u('gummy')} />
                {/* specular highlight slides opposite the gaze, like light on a curved surface */}
                <g className="pet-spec">
                  <ellipse cx="80" cy="68" rx="22" ry="9" transform="rotate(-18 80 68)" fill="#fff" opacity="0.6" filter={u('blur')} />
                  <circle cx="70" cy="64" r="3.2" fill="#fff" opacity="0.9" />
                </g>
                {breed === 'watch' && <ellipse cx="120" cy="92" rx="17" ry="14" fill={u('dark')} opacity="0.55" />}

                <g className="pet-face">
                  <ellipse className="pet-cheek" cx="70" cy="114" rx="9" ry="5" />
                  <ellipse className="pet-cheek" cx="130" cy="114" rx="9" ry="5" />
                  <Face state={face} />
                </g>
              </g>
            </g>

            <Prop breed={breed} u={u} />
          </g>
        </g>
      </svg>
    </div>
  );
}

type FaceKind = DogState | 'watching';

/** Motion graphics around the dog, one set per job. */
type FxKind = 'thoughts' | 'sonar' | 'scan' | 'dig' | 'waves' | 'confetti' | 'smoke';

function fxFor(breed: Breed, state: DogState): FxKind | null {
  switch (state) {
    case 'thinking':
      return 'thoughts';
    case 'searching':
      return breed === 'watch' ? 'scan' : 'sonar';
    case 'remembering':
      return 'dig';
    case 'answering':
      return 'waves';
    case 'happy':
      return 'confetti';
    case 'error':
      return 'smoke';
    default:
      return null;
  }
}

const FX_COUNT: Record<FxKind, number> = { thoughts: 3, sonar: 3, scan: 4, dig: 9, waves: 3, confetti: 14, smoke: 3 };

function Fx({ kind }: { kind: FxKind | null }) {
  if (!kind) return null;
  return (
    <div className={`pet-fx fx-${kind}`} aria-hidden="true">
      {Array.from({ length: FX_COUNT[kind] }, (_, i) => (
        <span key={i} style={{ '--i': i } as CSSProperties} />
      ))}
    </div>
  );
}

/** Ear shape is what tells the dogs apart at a glance, even at avatar size. */
function Ears({ breed, u }: { breed: Breed; u: (n: string) => string }) {
  if (breed === 'scout') {
    // pointy, upright
    return (
      <>
        <g className="pet-ear ear-l"><path d="M56 70 C 46 44, 50 22, 60 16 C 70 24, 82 42, 84 58 Z" fill={u('dark')} filter={u('gummy')} /></g>
        <g className="pet-ear ear-r"><path d="M144 70 C 154 44, 150 22, 140 16 C 130 24, 118 42, 116 58 Z" fill={u('dark')} filter={u('gummy')} /></g>
      </>
    );
  }
  if (breed === 'bones') {
    // round, teddy-like
    return (
      <>
        <g className="pet-ear ear-l"><circle cx="58" cy="56" r="20" fill={u('dark')} filter={u('gummy')} /></g>
        <g className="pet-ear ear-r"><circle cx="142" cy="56" r="20" fill={u('dark')} filter={u('gummy')} /></g>
      </>
    );
  }
  if (breed === 'watch') {
    // one up, one flopped: the skeptical look
    return (
      <>
        <g className="pet-ear ear-l"><path d="M58 70 C 48 46, 52 24, 62 18 C 72 26, 82 44, 84 60 Z" fill={u('dark')} filter={u('gummy')} /></g>
        <g className="pet-ear ear-r"><ellipse cx="150" cy="96" rx="16" ry="30" transform="rotate(-22 150 96)" fill={u('dark')} filter={u('gummy')} /></g>
      </>
    );
  }
  // biscuit: long and floppy
  return (
    <>
      <g className="pet-ear ear-l"><ellipse cx="50" cy="98" rx="16" ry="32" transform="rotate(22 50 98)" fill={u('dark')} filter={u('gummy')} /></g>
      <g className="pet-ear ear-r"><ellipse cx="150" cy="98" rx="16" ry="32" transform="rotate(-22 150 98)" fill={u('dark')} filter={u('gummy')} /></g>
    </>
  );
}

function Prop({ breed, u }: { breed: Breed; u: (n: string) => string }) {
  if (breed === 'scout') {
    return (
      <g className="pet-prop prop-magnifier">
        <circle cx="152" cy="122" r="15" fill="rgba(255,255,255,0.35)" stroke={u('dark')} strokeWidth="7" />
        <rect x="160" y="133" width="8" height="22" rx="4" transform="rotate(-40 164 144)" fill={u('dark')} />
        <ellipse cx="146" cy="116" rx="5" ry="3" fill="#fff" opacity="0.8" />
      </g>
    );
  }
  if (breed === 'bones') {
    return (
      <g className="pet-prop prop-bone">
        <rect x="128" y="150" width="40" height="10" rx="5" fill="#fffaf0" filter={u('gummy')} />
        <circle cx="128" cy="150" r="7" fill="#fffaf0" filter={u('gummy')} />
        <circle cx="128" cy="160" r="7" fill="#fffaf0" filter={u('gummy')} />
        <circle cx="168" cy="150" r="7" fill="#fffaf0" filter={u('gummy')} />
        <circle cx="168" cy="160" r="7" fill="#fffaf0" filter={u('gummy')} />
      </g>
    );
  }
  if (breed === 'watch') {
    return (
      <g className="pet-prop prop-badge">
        <circle cx="100" cy="150" r="13" fill={u('bulb')} filter={u('gummy')} />
        <path d="M94 150 L 99 155 L 107 145" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    );
  }
  return (
    <g className="pet-prop prop-bow">
      <path d="M86 140 L 100 147 L 86 154 Z" fill={u('bulb')} filter={u('gummy')} />
      <path d="M114 140 L 100 147 L 114 154 Z" fill={u('bulb')} filter={u('gummy')} />
      <circle cx="100" cy="147" r="4.5" fill={u('bulb')} />
    </g>
  );
}

function PetDefs({ id }: { id: string }) {
  return (
    <defs>
      {/* Gummy body: bright top-left, deep bottom-right. Colours come from CSS vars set per breed. */}
      <radialGradient id={`${id}-body`} cx="34%" cy="28%" r="80%">
        <stop offset="0%" style={{ stopColor: 'var(--pet-hi)' }} />
        <stop offset="45%" style={{ stopColor: 'var(--pet-mid)' }} />
        <stop offset="100%" style={{ stopColor: 'var(--pet-lo)' }} />
      </radialGradient>
      <radialGradient id={`${id}-dark`} cx="35%" cy="30%" r="85%">
        <stop offset="0%" style={{ stopColor: 'var(--pet-mid)' }} />
        <stop offset="100%" style={{ stopColor: 'var(--pet-deep)' }} />
      </radialGradient>
      <radialGradient id={`${id}-bulb`} cx="35%" cy="30%" r="70%">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="40%" style={{ stopColor: 'var(--pet-glow)' }} />
        <stop offset="100%" style={{ stopColor: 'var(--pet-glow-deep)' }} />
      </radialGradient>

      {/* Soft 3D: dark inner shadow bottom-right + light inner rim top-left. */}
      <filter id={`${id}-gummy`} x="-20%" y="-20%" width="140%" height="140%">
        <feOffset in="SourceAlpha" dx="-6" dy="-8" result="o1" />
        <feGaussianBlur in="o1" stdDeviation="7" result="b1" />
        <feComposite in="SourceAlpha" in2="b1" operator="arithmetic" k2="1" k3="-1" result="edgeDark" />
        <feFlood style={{ floodColor: 'var(--pet-shade)' }} floodOpacity="0.55" />
        <feComposite in2="edgeDark" operator="in" result="shade" />
        <feOffset in="SourceAlpha" dx="5" dy="6" result="o2" />
        <feGaussianBlur in="o2" stdDeviation="5" result="b2" />
        <feComposite in="SourceAlpha" in2="b2" operator="arithmetic" k2="1" k3="-1" result="edgeLight" />
        <feFlood floodColor="#ffffff" floodOpacity="0.6" />
        <feComposite in2="edgeLight" operator="in" result="light" />
        <feMerge>
          <feMergeNode in="SourceGraphic" />
          <feMergeNode in="shade" />
          <feMergeNode in="light" />
        </feMerge>
      </filter>
      <filter id={`${id}-blur`} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="4" />
      </filter>
    </defs>
  );
}

/** Tiny, minimal faces: dashes and dots. */
function Face({ state }: { state: FaceKind }) {
  switch (state) {
    case 'idle':
      return (
        <>
          <rect className="pet-eye" x="75" y="98" width="13" height="3.5" rx="1.75" />
          <rect className="pet-eye" x="112" y="98" width="13" height="3.5" rx="1.75" />
          <Nose />
        </>
      );
    case 'happy':
      return (
        <>
          <path className="pet-eye-line" d="M75 101 Q 81.5 93 88 101" />
          <path className="pet-eye-line" d="M112 101 Q 118.5 93 125 101" />
          <Nose />
          <path d="M95 117 Q 100 128 105 117 Z" className="pet-tongue" />
        </>
      );
    case 'error':
      return (
        <>
          <path className="pet-eye-line" d="M76 94 L 86 100 L 76 106" />
          <path className="pet-eye-line" d="M124 94 L 114 100 L 124 106" />
          <Nose />
          <path className="pet-eye-line" d="M94 121 Q 100 116 106 121" />
        </>
      );
    case 'remembering':
      return (
        <>
          <rect className="pet-eye" x="75" y="99" width="13" height="3.5" rx="1.75" />
          <rect className="pet-eye" x="112" y="99" width="13" height="3.5" rx="1.75" />
          <Nose />
          <circle cx="104" cy="120" r="2.4" className="pet-ink" />
        </>
      );
    case 'answering':
      return (
        <>
          <ellipse className="pet-eye" cx="81.5" cy="99" rx="5" ry="6" />
          <ellipse className="pet-eye" cx="118.5" cy="99" rx="5" ry="6" />
          <Nose />
          <ellipse className="pet-ink pet-talk" cx="100" cy="120" rx="4.5" ry="3.5" />
        </>
      );
    default:
      return (
        <>
          <g className="pet-look">
            <ellipse className="pet-eye" cx="81.5" cy="99" rx="5" ry="6" />
            <ellipse className="pet-eye" cx="118.5" cy="99" rx="5" ry="6" />
            <circle cx="83" cy="97" r="1.6" fill="#fff" />
            <circle cx="120" cy="97" r="1.6" fill="#fff" />
          </g>
          <Nose />
        </>
      );
  }
}

const Nose = () => <ellipse cx="100" cy="110" rx="4.5" ry="3" className="pet-ink" />;

/** Small static head for message avatars and the pack bar. */
export function DogAvatar({ breed, size = 28 }: { breed: Breed; size?: number }) {
  const id = useId().replace(/:/g, '');
  const u = (name: string) => `url(#${id}-${name})`;
  return (
    <svg className="avatar pet-avatar" data-breed={breed} width={size} height={size} viewBox="28 8 144 136" aria-hidden="true">
      <PetDefs id={id} />
      <Ears breed={breed} u={u} />
      <rect x="46" y="48" width="108" height="92" rx="46" fill={u('body')} filter={u('gummy')} />
      {breed === 'watch' && <ellipse cx="120" cy="92" rx="17" ry="14" fill={u('dark')} opacity="0.55" />}
      <ellipse className="pet-eye" cx="81.5" cy="99" rx="6" ry="7" />
      <ellipse className="pet-eye" cx="118.5" cy="99" rx="6" ry="7" />
      <ellipse cx="100" cy="112" rx="5" ry="3.5" className="pet-ink" />
    </svg>
  );
}
