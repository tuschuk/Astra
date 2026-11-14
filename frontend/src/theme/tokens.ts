/**
 * Astra design tokens — the single home for every color, font, type style,
 * spacing step, radius, glow and motion value in the app.
 *
 * Why this file exists: the visual system (docs/styling_guide.md, extracted
 * from the Max Method app) lives in exactly one place so a color can never
 * drift between screens. Nothing outside src/theme may hardcode a color,
 * font family or font size — import from here instead.
 */

/**
 * Color palette.
 *
 * Conventions that matter:
 * - `accent` (red) is identity: CTAs, active navigation, highlights.
 * - `green` means one thing only — "this is done/completed". Never use it
 *   decoratively, and never use red for completion.
 * - Surfaces are translucent white "lifts" over the near-black background,
 *   so the maroon gradient shows through and elevation tiers come free.
 */
export const colors = {
  /** Near-black page background base. */
  bg: '#0d0d0d',
  /** Dark maroon — the gradient bands layered over `bg`. */
  bgMaroon: '#2a0a0e',
  /** Navigation chrome (tab bar) — pure black. */
  navBg: '#000000',
  /** Primary text. */
  text: '#ffffff',
  /** Secondary text — 72% white (AAA contrast on `bg`). */
  muted: 'rgba(255, 255, 255, 0.72)',
  /** Decorative-only text — 50% white (AA). Never for information. */
  mutedDecor: 'rgba(255, 255, 255, 0.50)',

  /** Brand red. */
  accent: '#cc0404',
  /** Brighter red for pressed/hover states of solid-red controls. */
  accentBright: '#e00505',
  /** Red-tinted fill for selected/active states. */
  accentDim: 'rgba(204, 4, 4, 0.12)',
  /** Red border for active/selected elements. */
  accentBorder: 'rgba(204, 4, 4, 0.40)',

  /** Completion green — reserved strictly for "done" states. */
  green: '#2dba7e',
  /** Green-tinted fill for done states. */
  greenDim: 'rgba(45, 186, 126, 0.12)',
  /** Green border for done states. */
  greenBorder: 'rgba(45, 186, 126, 0.40)',

  /** Card / section fill (elevation tier 1). */
  surface: 'rgba(255, 255, 255, 0.04)',
  /** Pressed/hovered surface (tier 2). */
  surfaceHover: 'rgba(255, 255, 255, 0.07)',
  /** Nested or raised surface (tier 3). */
  surfaceDeep: 'rgba(255, 255, 255, 0.10)',
  /** Text inputs sit on translucent black, not white. */
  inputBg: 'rgba(0, 0, 0, 0.28)',
  /** Default hairline border. */
  border: 'rgba(255, 255, 255, 0.10)',
  /** Border for interactive elements (inputs, buttons). */
  borderStrong: 'rgba(255, 255, 255, 0.18)',

  /** Error text. */
  error: '#ff6b6b',
  /** Warning text. */
  warn: '#ff5555',
  /** Informational/caution badge text. */
  info: '#facc15',
  /** Gold — PR stars and highlights. */
  gold: '#ffd700',

  /** The faint red line color of the background grid texture. */
  gridLine: 'rgba(230, 57, 70, 0.04)',
  /** Red hairline that separates nav chrome from content. */
  navBorder: 'rgba(204, 4, 4, 0.32)',

  /** Muscle-group category colors (exercise library), with dim fills. */
  category: {
    upper: '#60a5fa',
    upperDim: 'rgba(96, 165, 250, 0.15)',
    lower: '#4ade80',
    lowerDim: 'rgba(74, 222, 128, 0.15)',
    core: '#c084fc',
    coreDim: 'rgba(192, 132, 252, 0.15)',
    cardio: '#fb923c',
    cardioDim: 'rgba(251, 146, 60, 0.15)',
  },
} as const;

/**
 * Font family names, as registered by the @expo-google-fonts packages.
 * React Native needs one family name per weight for static font files,
 * so each role lists the weights it actually uses.
 *
 * Roles (from the styling guide):
 * - heading: Permanent Marker — screen titles, brand, big display numbers only.
 * - sub: Space Grotesk — all "UI" text: labels, buttons, badges, stat values.
 * - body: Manrope — paragraphs, inputs, list text.
 */
export const fonts = {
  heading: 'PermanentMarker_400Regular',
  sub: 'SpaceGrotesk_400Regular',
  subMedium: 'SpaceGrotesk_500Medium',
  subSemiBold: 'SpaceGrotesk_600SemiBold',
  subBold: 'SpaceGrotesk_700Bold',
  body: 'Manrope_400Regular',
  bodyMedium: 'Manrope_500Medium',
  bodySemiBold: 'Manrope_600SemiBold',
  bodyBold: 'Manrope_700Bold',
} as const;

/**
 * Named text styles. Spread one of these into a style object instead of
 * assembling fontFamily/size/spacing by hand, so typography stays consistent.
 * Letter spacing is in device pixels (React Native has no em units); values
 * are the guide's em tracking multiplied by the font size.
 */
export const type = {
  /** Hero display — Permanent Marker, for the one big thing on a screen. */
  display: {
    fontFamily: fonts.heading,
    fontSize: 40,
    lineHeight: 46,
    color: colors.text,
  },
  /** Screen title — Permanent Marker. */
  title: {
    fontFamily: fonts.heading,
    fontSize: 30,
    lineHeight: 34,
    color: colors.text,
  },
  /** Section heading — Permanent Marker, small. */
  sectionTitle: {
    fontFamily: fonts.heading,
    fontSize: 20,
    lineHeight: 24,
    color: colors.text,
  },
  /**
   * The system's signature label: Space Grotesk, uppercase, wide tracking,
   * muted. Used for section labels, field labels and metadata.
   */
  label: {
    fontFamily: fonts.subBold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.5,
    textTransform: 'uppercase' as const,
    color: colors.muted,
  },
  /** Smaller, wider-tracked variant for tiny metadata and tab labels. */
  labelSmall: {
    fontFamily: fonts.subBold,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 1.4,
    textTransform: 'uppercase' as const,
    color: colors.muted,
  },
  /** Button text — Space Grotesk bold, uppercase, tracked. */
  button: {
    fontFamily: fonts.subBold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 1.7,
    textTransform: 'uppercase' as const,
    color: colors.text,
  },
  /** Card title — Space Grotesk semibold (the source system's card-name style). */
  cardTitle: {
    fontFamily: fonts.subSemiBold,
    fontSize: 16,
    lineHeight: 21,
    color: colors.text,
  },
  /** Stat value — Space Grotesk bold, large. Pairs with `labelSmall`. */
  statValue: {
    fontFamily: fonts.subBold,
    fontSize: 22,
    lineHeight: 26,
    color: colors.text,
  },
  /** Default body copy — Manrope. */
  body: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 21,
    color: colors.text,
  },
  /** Secondary body copy — Manrope, muted. */
  bodyMuted: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 21,
    color: colors.muted,
  },
  /** Small body copy (card metadata). */
  bodySmall: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: colors.muted,
  },
} as const;

/** Spacing scale in device pixels. Use these instead of ad-hoc numbers. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

/** Corner radii. `round` makes any square element a circle. */
export const radii = {
  sm: 4,
  md: 6,
  lg: 8,
  xl: 10,
  pill: 20,
  round: 999,
} as const;

/**
 * Glow shadows — the neon red (and green) halos from the styling guide.
 * iOS renders the colored shadow; Android approximates with elevation.
 */
export const glows = {
  accentSm: {
    shadowColor: colors.accent,
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  accent: {
    shadowColor: colors.accent,
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  greenSm: {
    shadowColor: colors.green,
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
} as const;

/** Motion durations in milliseconds (the guide's two transition speeds). */
export const motion = {
  fast: 150,
  medium: 250,
} as const;

/** Layout constants shared across screens. */
export const layout = {
  /** Horizontal screen padding. */
  screenPadding: spacing.lg,
  /** The background grid texture's cell size. */
  gridCell: 60,
  /** Minimum touch target size (accessibility rule from the guide). */
  minTouchTarget: 44,
} as const;
