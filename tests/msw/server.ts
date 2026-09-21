import { setupServer } from "msw/node";

/// Общий перехватчик для интеграционных тестов. Обработчики добавляет сам тест
/// через server.use() — так видно, на какой ответ API он рассчитан.
///
/// onUnhandledRequest: "error" — страховка от правила «ни один тест не ходит
/// в настоящий YouTube API»: незамоканный запрос валит тест, а не тратит квоту.
export const server = setupServer();
