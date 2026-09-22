/**
 * Знак сервиса: красный квадрат с белой Y.
 *
 * Красный квадрат со скруглением — узнаваемая форма кнопки YouTube, а внутри
 * вместо треугольника «плей» стоит Y: это анализатор, а не проигрыватель.
 *
 * Рисуется двумя линиями с круглыми концами, а не буквой из шрифта: текст
 * в SVG зависит от того, какие шрифты стоят на машине, и знак поехал бы
 * у половины зрителей.
 *
 * Те же пути лежат в `icon.svg` — оттуда их берёт вкладка браузера. Совпадение
 * стережёт тест: разъехавшийся знак заметить глазами почти невозможно.
 */

/** Единственная линия знака: галка Y и её ножка. */
export const LOGO_PATH = "M7 6.8 12 13l5-6.2M12 13v4.6";

export const LOGO_BACKGROUND = "#dc2626";

export function Logo({ className = "size-8" }: { readonly className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <rect width="24" height="24" rx="6" fill={LOGO_BACKGROUND} />
      <path
        d={LOGO_PATH}
        fill="none"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
