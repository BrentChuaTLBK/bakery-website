// Use the same dashboard navigation on desktop and in the mobile menu.
export async function selectDashboardSection(page, view) {
  const link = page.locator(`#admin-nav [data-view="${view}"]`);
  const toggle = page.locator('#admin-nav-toggle');
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') !== 'true') {
    await toggle.click();
  }
  await link.click();
}
