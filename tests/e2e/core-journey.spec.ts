import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "Str0ng-Passw0rd!";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@e2e.example`;
}

async function register(page: Page, email: string) {
  await page.goto("/register");
  await page.getByLabel("الاسم الكامل").fill("مستخدم الاختبار");
  await page.getByLabel("اسم المدرسة أو الجهة").fill("مدرسة الاختبار الآلي");
  await page.getByLabel("البريد الإلكتروني").fill(email);
  await page.getByLabel("كلمة المرور", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "إنشاء الحساب" }).click();
  await expect(page.getByRole("heading", { name: "ماذا تريد أن تقيس؟" })).toBeVisible();
}

test.describe("RTL & Arabic-first", () => {
  test("auth pages render right-to-left in Arabic", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.getByRole("heading", { name: "مرحبًا بعودتك" })).toBeVisible();
  });

  test("login shows a generic error for wrong credentials", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("البريد الإلكتروني").fill("nobody@e2e.example");
    await page.getByLabel("كلمة المرور", { exact: true }).fill("wrong-password-1");
    await page.getByRole("button", { name: "تسجيل الدخول" }).click();
    await expect(page.getByText("البريد الإلكتروني أو كلمة المرور غير صحيحة.")).toBeVisible();
  });
});

test.describe("app shell", () => {
  test("new account sees the composer, quick examples and the demo project", async ({ page, isMobile }) => {
    await register(page, uniqueEmail("shell"));
    await expect(page.getByPlaceholder(/أريد قياس أثر برنامج تدريبي/)).toBeVisible();
    await page.getByRole("button", { name: "رضا الطالبات عن برنامج" }).click();
    await expect(page.getByLabel("وصف ما تريد قياسه")).toHaveValue(/أريد قياس رضا الطالبات/);

    if (isMobile) {
      await expect(page.getByRole("navigation", { name: "التنقل الرئيسي" }).last()).toBeVisible();
    } else {
      // The sidebar sits on the right edge in RTL.
      const sidebar = page.locator("aside").first();
      const box = await sidebar.boundingBox();
      const viewport = page.viewportSize();
      expect(box && viewport && box.x > viewport.width / 2).toBeTruthy();
    }
  });

  test("command palette opens with Ctrl+K", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard shortcut is a desktop affordance");
    await register(page, uniqueEmail("cmdk"));
    await page.keyboard.press("Control+k");
    await expect(page.getByPlaceholder("اكتب أمرًا أو ابحث عن مشروع…")).toBeVisible();
  });

  test("demo project is clearly labeled as DEMO DATA", async ({ page }) => {
    await register(page, uniqueEmail("demo"));
    await page.goto("/projects");
    // Switch to the demo organization through the org switcher.
    await page.getByRole("button", { name: "تبديل المؤسسة" }).click();
    await page.getByRole("menuitemradio", { name: /مدرسة تجريبية/ }).click();
    await page.goto("/projects");
    await expect(page.getByText("قياس أثر برنامج تدريبي في الذكاء الاصطناعي")).toBeVisible();
    await expect(page.getByText("DEMO DATA").first()).toBeVisible();
  });
});

test.describe("core journey @ai", () => {
  test("idea → AI measurement plan → accept → project", async ({ page }) => {
    await register(page, uniqueEmail("journey"));
    await page.getByLabel("وصف ما تريد قياسه").fill("أريد قياس رضا الطالبات عن برنامج تدريبي.");
    await page.getByRole("button", { name: "ابدأ بالذكاء الاصطناعي" }).click();
    await expect(page.getByText("فهمنا أنك تريد:")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText("قياس الرضا").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "الأبعاد المقترحة" })).toBeVisible();
    await page.getByRole("button", { name: "قبول الخطة وإنشاء المشروع" }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/);
    await expect(page.getByRole("link", { name: "خطة القياس" })).toBeVisible();
  });
});
