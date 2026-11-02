/**
 * One pass through the Phase 1 workflow with three people in separate browsers:
 * an admin, an annotator and a reviewer.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";

const PASSWORD = "e2e password 123";
const SHOTS = process.env.E2E_SHOTS;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function newPage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext();
  return ctx.newPage();
}

async function acceptInvite(page: Page, url: string) {
  await page.goto(url);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Set password and sign in" }).click();
}

async function inviteUser(admin: Page, email: string, name: string, role: "annotator" | "reviewer"): Promise<string> {
  await admin.goto("/admin/users");
  await admin.getByLabel("Email").fill(email);
  await admin.getByLabel("Name").fill(name);
  const roles = admin.locator("fieldset.roles");
  for (const r of ["annotator", "reviewer", "admin"]) {
    const box = roles.getByLabel(r);
    if ((await box.isChecked()) !== (r === role)) await box.click();
  }
  await admin.getByRole("button", { name: "Create invite" }).click();
  const link = admin.locator("code.link");
  await expect(link).toContainText("/invite/");
  return (await link.textContent())!.trim();
}

/** Types the golden reference parallel-park plan into the editor. */
async function enterReferencePlan(page: Page) {
  const plan = [
    { gear: "R", steer: "0", dist: "1", speed: "1" },
    { gear: "R", steer: "-35", dist: "2.75", speed: "0.3" },
    { gear: "R", steer: "35", dist: "3", speed: "0.3" },
    { gear: "D", steer: "0", dist: "0.5", speed: "0.5" },
  ];
  for (let i = 1; i < plan.length; i++) await page.getByRole("button", { name: "Add move" }).click();
  for (const [i, m] of plan.entries()) {
    const row = page.locator("table.segments tbody tr").nth(i);
    await row.locator("select").selectOption(m.gear);
    await page.getByLabel(`Move ${i + 1} steering`).fill(m.steer);
    await page.getByLabel(`Move ${i + 1} distance`).fill(m.dist);
    await page.getByLabel(`Move ${i + 1} speed`).fill(m.speed);
  }
}

test("invite, claim, submit, replay, review, points and payout", async ({ browser }) => {
  // --- admin signs in through the bootstrap invite and creates tasks ---
  const admin = await newPage(browser);
  await acceptInvite(admin, process.env.E2E_ADMIN_INVITE!);
  await expect(admin).toHaveURL(/\/tasks$/); // the bootstrap admin also has the annotator role
  await admin.goto("/admin");
  await admin.getByLabel("Or specific seeds").fill("7, 1234");
  await admin.getByRole("button", { name: "Generate" }).click();
  await expect(admin.getByText("Created 2 Parallel park at the kerb tasks.")).toBeVisible();
  await shot(admin, "01-admin-overview");

  const annLink = await inviteUser(admin, "ann@e2e.test", "Ann Annotator", "annotator");
  const revLink = await inviteUser(admin, "rita@e2e.test", "Rita Reviewer", "reviewer");
  await shot(admin, "02-admin-users");

  // --- annotator: plan on the first task ---
  const ann = await newPage(browser);
  await acceptInvite(ann, annLink);
  await expect(ann).toHaveURL(/\/tasks$/);
  await ann.getByRole("button", { name: "Get a task" }).click();
  await expect(ann).toHaveURL(/\/task$/);
  await expect(ann.getByText(/h \d+ min left/)).toBeVisible();
  await expect(ann.getByRole("button", { name: "Submit plan" })).toBeDisabled();
  await enterReferencePlan(ann);
  await expect(ann.getByRole("status").filter({ hasText: "Goal reached without collision" })).toBeVisible();
  await ann.locator("table.segments tbody tr").nth(1).locator("td").first().click();
  await shot(ann, "03-annotator-task");
  await ann.getByRole("button", { name: "Submit plan" }).click();
  await expect(ann.getByText("Submitted. It will be scored and then reviewed.")).toBeVisible();

  // --- annotator: report the second task as unreachable ---
  await ann.getByRole("button", { name: "Get a task" }).click();
  await ann.getByLabel("Reason").selectOption("no_gap");
  await ann.getByRole("button", { name: "Goal can't be reached safely" }).click();
  await ann.getByRole("button", { name: "Confirm report" }).click();
  await expect(ann.getByText("Submitted.")).toBeVisible();

  // The worker scores both submissions.
  await expect
    .poll(
      async () => {
        await ann.reload();
        return ann.locator(".pill", { hasText: "Awaiting review" }).count();
      },
      { timeout: 60_000, intervals: [1000] },
    )
    .toBe(2);
  // No tasks left.
  await ann.getByRole("button", { name: "Get a task" }).click();
  await expect(ann.getByText("No tasks are available right now")).toBeVisible();
  await shot(ann, "04-annotator-dashboard");

  // --- admin assigns both to the reviewer ---
  const rev = await newPage(browser);
  await acceptInvite(rev, revLink);
  await expect(rev).toHaveURL(/\/reviews$/);
  await expect(rev.getByText("Nothing assigned to you right now")).toBeVisible();

  await admin.goto("/admin/reviews");
  await expect(admin.getByText("2 scored submissions waiting for a reviewer")).toBeVisible();
  await admin.getByLabel("Reviewer").selectOption({ label: "Rita Reviewer" });
  await admin.getByRole("button", { name: /Assign oldest/ }).click();
  await expect(admin.getByText("Assigned 2 submissions to Rita Reviewer.")).toBeVisible();

  // --- reviewer: accept the plan with 20 points, reject the report ---
  await rev.reload();
  await rev.getByRole("link", { name: "Review", exact: true }).first().click();
  const seen = new Set<string>();
  for (let i = 0; i < 2; i++) {
    await expect(rev).toHaveURL(/\/reviews\/[0-9a-f-]{36}$/);
    const url = rev.url();
    expect(seen.has(url), "opened the next item, not the same one").toBe(false);
    seen.add(url);
    await expect(rev.getByRole("heading", { name: "Verdict" })).toBeVisible();
    const unreachable = await rev.getByText("Reported as unreachable").isVisible();
    if (!unreachable) {
      await expect(rev.getByText("No problems found")).toBeVisible();
      await shot(rev, "05-reviewer-plan");
      await rev.getByLabel(/Points for this task/).fill("20");
      await rev.getByLabel("Why this many points?").fill("Tight gap, clean three-move park");
      await rev.getByRole("button", { name: "Accept and open next" }).click();
      await expect(rev).not.toHaveURL(url);
    } else {
      // A fresh form: nothing carried over from the previous item.
      await expect(rev.getByLabel(/Points for this task/)).toHaveValue("1");
      await rev.getByText("Reject", { exact: true }).click();
      await rev.getByLabel(/Comment for the annotator/).fill("A 6.5 m gap is enough for this car; try reversing in.");
      await rev.getByRole("button", { name: "Reject and open next" }).click();
      await expect(rev).not.toHaveURL(url);
    }
  }
  await expect(rev).toHaveURL(/\/reviews$/);
  await expect(rev.getByText("2 reviewed")).toBeVisible();

  // --- annotator sees points at once and requests a payout ---
  await ann.goto("/tasks");
  await expect(ann.locator(".pill", { hasText: "Accepted" })).toHaveCount(1);
  await expect(ann.locator(".pill", { hasText: "Rejected" })).toHaveCount(1);
  await expect(ann.getByText("A 6.5 m gap is enough")).toBeVisible();
  await ann.goto("/points");
  await expect(ann.locator(".big").first()).toContainText("20");
  await ann.getByRole("button", { name: "Request payout" }).click();
  await expect(ann.getByText("Requested 20 points ($5.00)")).toBeVisible();
  await expect(ann.locator(".big").first()).toContainText("0");

  // The reviewer earned 1 point per review.
  await rev.goto("/points");
  await expect(rev.locator(".big").first()).toContainText("2");

  // --- admin pays it out ---
  await admin.goto("/admin/payouts");
  await expect(admin.getByText("ann@e2e.test")).toBeVisible();
  await admin.getByRole("button", { name: "Contacted" }).click();
  await admin.getByLabel("Payment reference").fill("Interac e-Transfer CA1234");
  await admin.getByRole("button", { name: "Mark paid" }).click();
  await expect(admin.getByText("No open payout requests.")).toBeVisible();
  await admin.getByRole("button", { name: "All" }).click();
  await expect(admin.locator(".pill", { hasText: "Paid" })).toBeVisible();
  await shot(admin, "06-admin-payouts");

  await ann.reload();
  await expect(ann.locator(".pill", { hasText: "Paid" })).toBeVisible();
  await shot(ann, "07-annotator-points");
});
