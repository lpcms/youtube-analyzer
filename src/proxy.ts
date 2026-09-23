import { NextResponse, type NextRequest } from "next/server";

/**
 * Content-Security-Policy с одноразовым nonce.
 *
 * Не в `next.config.ts` вместе с остальными заголовками, потому что nonce
 * обязан быть свой на каждый ответ: угаданный nonce — это отсутствующий
 * nonce. Из статического конфига такого не выдать, поэтому заголовок
 * выставляется здесь, а Next сам проставляет этот nonce своим скриптам.
 *
 * Зачем это локальному сервису без авторизации: описания видео приходят
 * с YouTube, то есть на нашей странице живёт чужой текст. React выводит
 * его как текст и разметку не исполняет — CSP здесь второй рубеж, а не
 * первый.
 */

/**
 * Стили — `'unsafe-inline'`, и это осознанно.
 *
 * Таблица правит `style.width` у полосы прокрутки прямо в DOM, а это
 * инлайновый стиль: со строгим `style-src` вторая полоса прокрутки просто
 * перестала бы работать. Подмена стилей несравнимо безобиднее подмены
 * скриптов, и ради неё ломать рабочую вещь незачем.
 *
 * В режиме разработки нужен ещё и `'unsafe-eval'`: React восстанавливает
 * через eval серверные стеки ошибок в браузере. В прод-сборке он не нужен
 * ни React, ни Next.
 */
function policy(nonce: string, dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // Сервис ходит только к себе: к YouTube обращается сервер, не браузер.
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function proxy(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const value = policy(nonce, process.env.NODE_ENV === "development");

  // Заголовок кладётся и в запрос, и в ответ: из запроса его читает Next,
  // чтобы проставить nonce собственным скриптам.
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", value);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", value);
  return response;
}

export const config = {
  matcher: [
    {
      // Статика и оптимизированные картинки в CSP не нуждаются, а предзагрузка
      // ссылок не должна тратить на неё время: на каждый такой запрос
      // генерировался бы nonce, который никому не пригодится.
      source: "/((?!_next/static|_next/image|icon.svg).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
