import { testPrisma } from "./client";

/// Чистит базу ПЕРЕД тестом, а не после: упавший тест не доходит до уборки
/// за собой, и следующий получил бы мусор.
///
/// Порядок — от зависимых к справочникам. Каскады в схеме сделали бы своё
/// и при удалении одних каналов, но явный порядок не даёт молча потерять
/// строки, если каскад когда-нибудь снимут.
export async function resetDb(): Promise<void> {
  await testPrisma.videoStat.deleteMany();
  await testPrisma.fetchRun.deleteMany();
  await testPrisma.video.deleteMany();
  await testPrisma.channel.deleteMany();
}
