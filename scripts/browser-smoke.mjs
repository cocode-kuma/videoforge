import "dotenv/config";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const origin = process.env.PUBLIC_ORIGIN || "http://localhost:3088";
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "msedge",
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 960 },
  deviceScaleFactor: 1,
});
const errors = [];
const serverErrors = [];
const screenshotDir = ".test-artifacts/browser";
page.on("response", (r) => {
  if (r.status() === 500) serverErrors.push(r.url());
});
page.on("pageerror", (e) => errors.push(e.message));
await mkdir(screenshotDir, { recursive: true });
try {
  await page.goto(origin);
  await page.getByRole("heading", { name: "欢迎回到工作室" }).waitFor();
  await page.screenshot({ path: `${screenshotDir}/login-preview.png`, fullPage: true });
  await page.getByRole("button", { name: "免费注册" }).click();
  const email = `ui-${Date.now()}@example.com`;
  await page.getByLabel("怎么称呼你").fill("界面验证");
  await page.getByLabel("邮箱地址").fill(email);
  await page
    .getByLabel("密码", { exact: true })
    .fill("cocode-ui-test-password");
  await page.getByLabel("邀请码").fill("kuma");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await page.getByText("你的想象，").waitFor();
  await page.screenshot({ path: `${screenshotDir}/studio-preview.png`, fullPage: true });
  assert.equal(await page.locator("select").count(), 0);
  assert.equal(
    await page.locator(".panel-heading .lucide-ellipsis").count(),
    0,
  );
  await page.getByRole("combobox", { name: "视频时长" }).click();
  await page.getByRole("option", { name: /60 秒/ }).click();
  assert.equal(
    await page
      .getByRole("combobox", { name: "视频时长" })
      .getAttribute("data-value"),
    "60",
  );
  await page.getByRole("combobox", { name: "视频时长" }).press("Enter");
  await page.getByRole("combobox", { name: "视频时长" }).press("Home");
  await page.getByRole("combobox", { name: "视频时长" }).press("Enter");
  assert.equal(
    await page
      .getByRole("combobox", { name: "视频时长" })
      .getAttribute("data-value"),
    "15",
  );
  await page.getByRole("combobox", { name: "视频时长" }).click();
  await page.getByRole('listbox').evaluate(async el=>{
    await Promise.all(el.parentElement.getAnimations().map(animation=>animation.finished));
  });
  await page.screenshot({ path: `${screenshotDir}/dropdown-preview.png`, fullPage: true });
  await page.getByRole("combobox", { name: "视频时长" }).press("Escape");
  assert.equal(await page.getByRole("listbox").count(), 0);
  await page.getByRole("button", { name: "开始生成视频" }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "至少输入 5 个字" })
    .waitFor();
  await page.getByRole("button", { name: /产品宣传片/ }).click();
  assert.ok(
    (
      await page.getByRole("textbox", { name: "视频创意" }).inputValue()
    ).includes("科技耳机"),
  );
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByRole('textbox',{name:'项目名称'}).fill('   ');
  await page.getByRole('button',{name:'创建项目',exact:true}).click();
  await page.getByRole('dialog').getByRole('alert').waitFor();
  await page.getByRole("textbox", { name: "项目名称" }).fill("界面测试项目");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page.getByRole('button',{name:'界面测试项目的项目菜单',exact:true}).waitFor();
  await page.getByRole('button',{name:'新建项目'}).click();
  await page.getByRole('textbox',{name:'项目名称'}).fill('当前项目');
  await page.getByRole('button',{name:'创建项目',exact:true}).click();
  await page.getByRole('button',{name:'界面测试项目的项目菜单',exact:true}).click();
  await page.getByRole('menuitem',{name:'重命名',exact:true}).click();
  await page.getByRole("textbox", { name: "项目名称" }).fill("已重命名的作品");
  await page.getByRole("button", { name: "保存名称" }).click();
  await page.getByRole('button',{name:'已重命名的作品的项目菜单',exact:true}).waitFor();
  assert.equal(await page.locator('.topbar strong').innerText(),'当前项目');
  assert.equal(await page.locator('.topbar').getByRole('button',{name:/重命名|删除/}).count(),0);
  await page.getByRole('button',{name:'已重命名的作品的项目菜单',exact:true}).press('ArrowDown');
  await page.getByRole('menu',{name:'已重命名的作品的操作'}).waitFor();
  await page.screenshot({ path: `${screenshotDir}/project-menu-preview.png`, fullPage: true });
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('menu').count(),0);
  await page.getByRole("button", { name: "创作参数" }).click();
  assert.equal(await page.getByText('本地中文配音',{exact:true}).count(),0);
  await page.getByRole('combobox',{name:'创作类型'}).click();
  assert.equal(await page.getByRole('option').count(),12);
  const workflowPopup=await page.locator('.studio-select-menu').boundingBox();
  assert.ok(workflowPopup.y>=0&&workflowPopup.y+workflowPopup.height<=960);
  await page.getByRole('option',{name:/通用视频/}).click();
  await page.getByRole('combobox',{name:'背景音乐'}).click();
  await page.getByRole('option',{name:/代码生成音乐/}).click();
  assert.equal(await page.getByRole('combobox',{name:'背景音乐'}).getAttribute('data-value'),'generated');
  await page.getByLabel('上传项目素材').setInputFiles({name:'creative-notes.txt',mimeType:'text/plain',buffer:Buffer.from('使用深蓝背景和青色图形。')});
  await page.locator('.asset-row').getByText('creative-notes.txt',{exact:true}).waitFor();
  await page.getByRole("button", { name: "9:16", exact: true }).click();
  assert.equal(
    await page
      .getByRole("combobox", { name: "画面比例" })
      .getAttribute("data-value"),
    "9:16",
  );
  await page.getByRole("combobox", { name: "视觉风格" }).click();
  await page.getByRole("option", { name: /极简/ }).click();
  assert.equal(
    await page
      .getByRole("combobox", { name: "视觉风格" })
      .getAttribute("data-value"),
    "minimal",
  );
  await page.getByRole("combobox", { name: "视觉风格" }).click();
  await page.getByRole("heading", { name: "让画面更贴近你的想象" }).click();
  assert.equal(await page.getByRole("listbox").count(), 0);
  await page.getByRole("button", { name: "视频预览", exact: true }).click();
  assert.ok(
    !/插件市场|启用插件|API Key|模型设置|PTC/.test(
      await page.locator("body").innerText(),
    ),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button',{name:'创作参数'}).click();
  await page.getByRole('combobox',{name:'创作类型'}).click();
  const mobileWorkflow=await page.locator('.studio-select-menu').boundingBox();
  assert.ok(mobileWorkflow.x>=0&&mobileWorkflow.x+mobileWorkflow.width<=390&&mobileWorkflow.y>=0&&mobileWorkflow.y+mobileWorkflow.height<=844);
  await page.getByRole('option',{name:/Remotion 迁移/}).click();
  await page.getByRole('button',{name:'视频预览',exact:true}).click();
  await page.getByRole('combobox',{name:'画面比例'}).click();
  const popup=await page.locator('.studio-select-menu').boundingBox();
  assert.ok(popup.x>=0&&popup.x+popup.width<=390&&popup.y>=0&&popup.y+popup.height<=844);
  await page.getByRole('option',{name:/1:1/}).click();
  assert.equal(await page.getByRole('combobox',{name:'画面比例'}).getAttribute('data-value'),'1:1');
  await page.screenshot({ path: `${screenshotDir}/mobile-preview.png`, fullPage: true });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole('button',{name:'已重命名的作品的项目菜单',exact:true}).click();
  await page.getByRole('menuitem',{name:'删除项目',exact:true}).click();
  await page.getByRole('dialog').getByText('「已重命名的作品」中的分镜、记录和视频会一并删除。').waitFor();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  assert.equal(await page.locator('.topbar strong').innerText(),'当前项目');
  assert.equal(await page.getByRole('button',{name:'已重命名的作品的项目菜单',exact:true}).count(),0);
  await page.getByRole('button',{name:'当前项目的项目菜单',exact:true}).click();
  await page.getByRole('menuitem',{name:'删除项目',exact:true}).click();
  await page.getByRole('button',{name:'确认删除',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.getByText("你的想象，").waitFor();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.getByRole("heading", { name: "欢迎回到工作室" }).waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual(serverErrors, []);
  console.log(
    "cocode 酷码工作室 · Cocode Studio VideoForge — 桌面/移动 UI 验证通过",
  );
} finally {
  await browser.close();
}
