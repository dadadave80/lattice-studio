/**
 * S0's UI primitives: every control the app is built from, on Base UI, styled with tokens only, accessible
 * by construction. Import from `@/ui`.
 */
export { Button } from "./buttons/Button";
export type { ButtonProps, ButtonVariant } from "./buttons/Button";
export { IconButton } from "./buttons/IconButton";
export type { IconButtonProps } from "./buttons/IconButton";
export { CommandButton } from "./buttons/CommandButton";
export type { CommandButtonProps } from "./buttons/CommandButton";

export { Tooltip } from "./tooltip/Tooltip";
export type { TooltipProps, TooltipSide } from "./tooltip/Tooltip";
export { ReasonTooltip } from "./tooltip/ReasonTooltip";
export type { ReasonTooltipProps } from "./tooltip/ReasonTooltip";

export { Kbd } from "./keys/Kbd";
export type { KbdProps } from "./keys/Kbd";
export { ShortcutChip } from "./keys/ShortcutChip";
export type { ShortcutChipProps } from "./keys/ShortcutChip";
export { ariaKeyShortcuts, firstKeys, isSingleKey, keyLabel, specKeys } from "./keys/key-labels";

export { StatusChip } from "./status/StatusChip";
export type { StatusChipProps, StatusTone } from "./status/StatusChip";
export { Banner } from "./status/Banner";
export type { BannerProps, BannerTone } from "./status/Banner";
export { HATCH_FILL, HATCH_PATTERN_ID, HatchDefs, HatchPattern, hatchedClass } from "./status/Hatch";

export { Icon } from "./icons/Icon";
export type { IconProps } from "./icons/Icon";
export { ICON_NAMES } from "./icons/icon-paths";
export type { IconName } from "./icons/icon-paths";

export { copyHint, copyLabel, copyText, copyValue } from "./copy/copy-text";
export type { CopyOptions, CopyResult } from "./copy/copy-text";

export * from "./fields";
export * from "./overlays";
export * from "./nav";

export { cx } from "./shared/cx";
export { detectPlatform, platform, usePlatform } from "./shared/platform";
export { VisuallyHidden } from "./shared/VisuallyHidden";

// `UiGallery` is deliberately not re-exported: the barrel is in the entry chunk and the gallery (with its
// CSS) must not be. Load it with `lazy(() => import("@/ui/UiGallery").then((m) => ({ default: m.UiGallery })))`.
