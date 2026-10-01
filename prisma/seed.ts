// Seed: branch, users, menu, modifiers, ingredients, recipes, tables, customers, settings.
// Idempotent — skips when the demo branch already exists.
// Run: npx tsx prisma/seed.ts  (after `prisma generate`; run from the project root)
import { PrismaClient } from "@prisma/client";
import { hashPin } from "../src/lib/pin.js";
import { hashPassword } from "better-auth/crypto";

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.branch.findFirst({ where: { name: "Downtown Flagship" } });
  if (existing) {
    console.log("Seed already applied — skipping.");
    return;
  }

  // ── Branch ──────────────────────────────────────────────────────
  const branch = await prisma.branch.create({
    data: {
      name: "Downtown Flagship",
      nameMy: "မြို့လယ်ဆိုင်ခွဲ",
      address: "No. 123, Pyay Road, Kamayut Township, Yangon",
      addressMy: "အမှတ် ၁၂၃၊ ပြည်လမ်း၊ ကမာရွတ်မြို့နယ်၊ ရန်ကုန်",
      phone: "09123456789",
      taxId: "1002003004",
      managerName: "Aung Min",
      openingHours: "07:00 - 21:00",
      timezone: "Asia/Yangon",
    },
  });

  // ── Users ───────────────────────────────────────────────────────
  const pwHash = await hashPassword("password123");
  const staff: Array<[string, string | undefined, string, string, string, string]> = [
    // name, nameMy, email, role, pin, phone
    ["Admin Owner", "ဆိုင်ရှင်", "owner@cafe.local", "owner", "1234", "09900000001"],
    ["Aung Min", "အောင်မင်း", "manager@cafe.local", "manager", "2345", "09900000002"],
    ["Su Su", "စုစု", "cashier@cafe.local", "cashier", "3456", "09900000003"],
    ["Ko Ko", "ကိုကို", "barista@cafe.local", "barista", "4567", "09900000004"],
  ];
  for (const [name, nameMy, email, role, pin, phone] of staff) {
    const user = await prisma.user.create({
      data: {
        name, nameMy, email, role, phone, branchId: branch.id,
        emailVerified: true, pinHash: hashPin(pin),
      },
    });
    await prisma.account.create({
      data: { userId: user.id, accountId: email, providerId: "credential", password: pwHash },
    });
  }

  // ── Categories ──────────────────────────────────────────────────
  const catData: Array<[string, string | undefined, number]> = [
    ["Hot Drinks", "ပူသောအချိုရည်", 1],
    ["Iced Drinks", "အေးသောအချိုရည်", 2],
    ["Smoothies & Juice", "စမူသီနှင့်အရည်ဖျော်", 3],
    ["Pastries", "မုန့်များ", 4],
    ["Food", "အစားအစာ", 5],
  ];
  const cats: Record<string, string> = {};
  for (const [name, nameMy, sortOrder] of catData) {
    const c = await prisma.category.create({ data: { branchId: branch.id, name, nameMy, sortOrder } });
    cats[name] = c.id;
  }

  // ── Modifier groups ─────────────────────────────────────────────
  const groups: Record<string, string> = {};
  const mkGroup = async (name: string, nameMy: string | undefined, kind: string, required: boolean, multiSelect: boolean, sortOrder: number, options: Array<[string, string | undefined, number]>) => {
    const g = await prisma.modifierGroup.create({
      data: { branchId: branch.id, name, nameMy, kind, required, multiSelect, sortOrder },
    });
    groups[name] = g.id;
    let i = 0;
    for (const [on, onMy, delta] of options) {
      await prisma.modifierOption.create({
        data: { groupId: g.id, name: on, nameMy: onMy, priceDeltaKs: delta, sortOrder: i++ },
      });
    }
  };
  await mkGroup("Size", "အရွယ်အစား", "size", true, false, 1, [
    ["Regular", "ရိုးရိုး", 0], ["Large", "ကြီး", 1000],
  ]);
  await mkGroup("Sugar", "သကြား", "sugar", true, false, 2, [
    ["0%", "လုံးဝမထည့်", 0], ["50%", "တစ်ဝက်", 0], ["75%", "၇၅%", 0], ["100%", "အပြည့်", 0],
  ]);
  await mkGroup("Milk", "နို့", "milk", false, false, 3, [
    ["Fresh Milk", "နွားနို့", 0], ["Condensed", "နို့ဆီ", 0], ["Oat Milk", "Oat နို့", 500],
  ]);
  await mkGroup("Ice", "ရေခဲ", "ice", false, false, 4, [
    ["Less Ice", "ရေခဲနည်း", 0], ["Normal", "ပုံမှန်", 0], ["Extra Ice", "ရေခဲပို", 0],
  ]);
  await mkGroup("Extras", "ပိုထည့်ရန်", "extra", false, true, 5, [
    ["Extra Shot", "ကော်ဖီပိုထည့်", 1000], ["Whipped Cream", "ခရင်မ်ပို", 800],
  ]);

  // ── Menu items ──────────────────────────────────────────────────
  type Item = [string, string | undefined, string, number, string, string[]]; // name, nameMy, cat, price, station, modifierGroups
  const items: Item[] = [
    ["Espresso", "အက်စ်ပရက်ဆို", "Hot Drinks", 2500, "barista", ["Size", "Sugar"]],
    ["Americano", "အမေရိကာနို", "Hot Drinks", 3000, "barista", ["Size", "Sugar"]],
    ["Latte", "လတ္တေး", "Hot Drinks", 4000, "barista", ["Size", "Sugar", "Milk"]],
    ["Cappuccino", "ကပူချီနို", "Hot Drinks", 4000, "barista", ["Size", "Sugar", "Milk"]],
    ["Mocha", "မိုခါ", "Hot Drinks", 4500, "barista", ["Size", "Sugar", "Milk", "Extras"]],
    ["Myanmar Milk Tea", "လဖက်ရည်", "Hot Drinks", 2000, "barista", ["Size", "Sugar"]],
    ["Hot Chocolate", "ချောကလက်ပူ", "Hot Drinks", 3500, "barista", ["Size", "Sugar", "Milk"]],
    ["Iced Americano", "အမေရိကာနိုအေး", "Iced Drinks", 3500, "barista", ["Size", "Sugar", "Ice"]],
    ["Iced Latte", "လတ္တေးအေး", "Iced Drinks", 4500, "barista", ["Size", "Sugar", "Milk", "Ice", "Extras"]],
    ["Iced Mocha", "မိုခါအေး", "Iced Drinks", 5000, "barista", ["Size", "Sugar", "Milk", "Ice", "Extras"]],
    ["Thai Tea", "ထိုင်းလက်ဖက်ရည်အေး", "Iced Drinks", 3500, "barista", ["Size", "Sugar", "Ice"]],
    ["Matcha Latte", "မက်ချာလတ္တေး", "Iced Drinks", 5000, "barista", ["Size", "Sugar", "Milk", "Ice"]],
    ["Mango Smoothie", "သရက်သီးစမူသီ", "Smoothies & Juice", 4500, "barista", ["Size", "Sugar", "Ice"]],
    ["Avocado Smoothie", "ထောပတ်သီးစမူသီ", "Smoothies & Juice", 5000, "barista", ["Size", "Sugar", "Ice"]],
    ["Orange Juice", "လိမ္မော်ရည်", "Smoothies & Juice", 4000, "barista", ["Size", "Ice"]],
    ["Croissant", "ခရိုဆန့်", "Pastries", 3500, "kitchen", []],
    ["Chocolate Cake", "ချောကလက်ကိတ်", "Pastries", 4000, "kitchen", []],
    ["Banana Bread", "ငှက်ပျောပေါင်မုန့်", "Pastries", 2500, "kitchen", []],
    ["Chicken Sandwich", "ကြက်သားဆန်းဒွစ်", "Food", 6000, "kitchen", []],
    ["Club Sandwich", "ကလပ်ဆန်းဒွစ်", "Food", 7000, "kitchen", []],
  ];
  const itemIds: Record<string, string> = {};
  let sort = 0;
  for (const [name, nameMy, cat, price, station, mods] of items) {
    const it = await prisma.menuItem.create({
      data: { branchId: branch.id, categoryId: cats[cat], name, nameMy, priceKs: price, station, sortOrder: sort++ },
    });
    itemIds[name] = it.id;
    for (const m of mods) {
      await prisma.menuItemModifier.create({ data: { menuItemId: it.id, groupId: groups[m] } });
    }
  }

  // ── Ingredients ─────────────────────────────────────────────────
  type Ing = [string, string | undefined, string, string, number, number, number, number, boolean];
  // name, nameMy, unit, baseUnit, toBaseFactor, stock(base), threshold(base), costPerBase, expiryTracking
  const ings: Ing[] = [
    ["Coffee Beans", "ကော်ဖီစေ့", "kg", "g", 1000, 5000, 1000, 80, false],
    ["Fresh Milk", "နွားနို့", "L", "ml", 1000, 20000, 5000, 3, true],
    ["Condensed Milk", "နို့ဆီ", "can", "g", 380, 3800, 760, 15, true],
    ["Sugar", "သကြား", "kg", "g", 1000, 10000, 2000, 2, false],
    ["Black Tea", "လက်ဖက်ခြောက်", "kg", "g", 1000, 2000, 500, 60, false],
    ["Thai Tea Mix", "ထိုင်းလက်ဖက်ရည်မှုန့်", "kg", "g", 1000, 1500, 300, 50, false],
    ["Chocolate Powder", "ချောကလက်မှုန့်", "kg", "g", 1000, 2000, 400, 40, false],
    ["Matcha Powder", "မက်ချာမှုန့်", "kg", "g", 1000, 1000, 200, 120, false],
    ["Mango", "သရက်သီး", "kg", "g", 1000, 8000, 2000, 8, true],
    ["Avocado", "ထောပတ်သီး", "pcs", "pcs", 1, 30, 10, 2500, true],
    ["Orange", "လိမ္မော်", "pcs", "pcs", 1, 50, 15, 800, true],
    ["Paper Cup 8oz", "စက္ကူခွက်", "pack", "pcs", 50, 500, 100, 100, false],
    ["Lid", "အဖုံး", "pack", "pcs", 50, 500, 100, 50, false],
    ["Straw", "ပိုက်", "pack", "pcs", 100, 1000, 200, 20, false],
    ["Croissant (finished)", "ခရိုဆန့်(အချော)", "pcs", "pcs", 1, 20, 5, 2000, true],
    ["Chocolate Cake (finished)", "ချောကလက်ကိတ်(အချော)", "pcs", "pcs", 1, 12, 4, 2500, true],
    ["Banana Bread (finished)", "ငှက်ပျောပေါင်မုန့်(အချော)", "pcs", "pcs", 1, 15, 5, 1500, true],
    ["Chicken Sandwich (finished)", "ကြက်သားဆန်းဒွစ်(အချော)", "pcs", "pcs", 1, 10, 3, 4000, true],
    ["Club Sandwich (finished)", "ကလပ်ဆန်းဒွစ်(အချော)", "pcs", "pcs", 1, 10, 3, 4500, true],
  ];
  const ingIds: Record<string, string> = {};
  for (const [name, nameMy, unit, baseUnit, toBaseFactor, stock, threshold, cost, expiry] of ings) {
    const ing = await prisma.ingredient.create({
      data: {
        branchId: branch.id, name, nameMy, unit, baseUnit, toBaseFactor,
        currentStock: stock, lowStockThreshold: threshold, costPerBaseUnit: cost,
        expiryTracking: expiry,
      },
    });
    ingIds[name] = ing.id;
  }

  // ── Recipes (BOM, quantities in base units) ─────────────────────
  const CUP = "Paper Cup 8oz";
  const recipes: Array<[string, Array<[string, number]>]> = [
    ["Espresso", [["Coffee Beans", 18], [CUP, 1]]],
    ["Americano", [["Coffee Beans", 18], [CUP, 1]]],
    ["Latte", [["Coffee Beans", 18], ["Fresh Milk", 200], [CUP, 1]]],
    ["Cappuccino", [["Coffee Beans", 18], ["Fresh Milk", 150], [CUP, 1]]],
    ["Mocha", [["Coffee Beans", 18], ["Fresh Milk", 150], ["Chocolate Powder", 15], [CUP, 1]]],
    ["Myanmar Milk Tea", [["Black Tea", 10], ["Condensed Milk", 20], ["Sugar", 10], ["Fresh Milk", 100], [CUP, 1]]],
    ["Hot Chocolate", [["Chocolate Powder", 25], ["Fresh Milk", 200], [CUP, 1]]],
    ["Iced Americano", [["Coffee Beans", 18], [CUP, 1], ["Lid", 1], ["Straw", 1]]],
    ["Iced Latte", [["Coffee Beans", 18], ["Fresh Milk", 150], [CUP, 1], ["Lid", 1], ["Straw", 1]]],
    ["Iced Mocha", [["Coffee Beans", 18], ["Fresh Milk", 120], ["Chocolate Powder", 15], [CUP, 1], ["Lid", 1], ["Straw", 1]]],
    ["Thai Tea", [["Thai Tea Mix", 15], ["Condensed Milk", 25], ["Sugar", 10], [CUP, 1], ["Lid", 1], ["Straw", 1]]],
    ["Matcha Latte", [["Matcha Powder", 8], ["Fresh Milk", 200], ["Sugar", 5], [CUP, 1], ["Lid", 1], ["Straw", 1]]],
    ["Mango Smoothie", [["Mango", 200], ["Fresh Milk", 100], ["Sugar", 10], [CUP, 1], ["Lid", 1], ["Straw", 1]]],
    ["Avocado Smoothie", [["Avocado", 1], ["Fresh Milk", 100], ["Condensed Milk", 15], [CUP, 1], ["Lid", 1], ["Straw", 1]]],
    ["Orange Juice", [["Orange", 3], [CUP, 1], ["Straw", 1]]],
    ["Croissant", [["Croissant (finished)", 1]]],
    ["Chocolate Cake", [["Chocolate Cake (finished)", 1]]],
    ["Banana Bread", [["Banana Bread (finished)", 1]]],
    ["Chicken Sandwich", [["Chicken Sandwich (finished)", 1]]],
    ["Club Sandwich", [["Club Sandwich (finished)", 1]]],
  ];
  for (const [item, lines] of recipes) {
    for (const [ing, qty] of lines) {
      await prisma.recipe.create({
        data: { menuItemId: itemIds[item], ingredientId: ingIds[ing], quantity: qty },
      });
    }
  }
  // Backfill estimated costKs on items from recipes
  for (const [item, lines] of recipes) {
    let cost = 0;
    for (const [ing, qty] of lines) {
      const i = await prisma.ingredient.findUnique({ where: { id: ingIds[ing] } });
      cost += Math.round(qty * (i?.costPerBaseUnit ?? 0));
    }
    await prisma.menuItem.update({ where: { id: itemIds[item] }, data: { costKs: cost } });
  }

  // ── Tables ──────────────────────────────────────────────────────
  const tables: Array<[string, string, number, number, number]> = [
    ["T1", "Main", 4, 40, 40], ["T2", "Main", 4, 160, 40], ["T3", "Main", 2, 280, 40],
    ["T4", "Main", 6, 40, 160], ["T5", "Main", 4, 160, 160], ["T6", "Main", 2, 280, 160],
    ["B1", "Balcony", 4, 40, 280], ["B2", "Balcony", 4, 160, 280],
  ];
  for (const [label, zone, seats, x, y] of tables) {
    await prisma.cafeTable.create({ data: { branchId: branch.id, label, zone, seats, posX: x, posY: y } });
  }

  // ── Customers ───────────────────────────────────────────────────
  const customers: Array<[string, string | undefined, string, number]> = [
    ["Aye Aye", "အေးအေး", "09111111111", 7],
    ["Min Thu", "မင်းသူ", "09222222222", 3],
    ["Hla Hla", "လှလှ", "09333333333", 12],
  ];
  for (const [name, nameMy, phone, stamps] of customers) {
    await prisma.customer.create({
      data: { branchId: branch.id, name, nameMy, phone, stamps, points: stamps * 40, visitCount: stamps, totalSpendKs: stamps * 4500 },
    });
  }

  // ── Settings ────────────────────────────────────────────────────
  const settings: Array<[string, unknown]> = [
    ["tax.rate", 5],
    ["tax.inclusive", true],
    ["tax.id", "1002003004"],
    ["receipt.header", { lines: ["☕ Downtown Flagship", "မြို့လယ်ဆိုင်ခွဲ", "No.123 Pyay Road, Yangon", "Tel: 09123456789"] }],
    ["receipt.footer", { lines: ["ကျေးဇူးတင်ပါတယ်!", "Thank you, come again 🙏"] }],
    ["loyalty.stampsToFree", 10],
    ["loyalty.pointsPerKs", 100],
    ["loyalty.freeItemCategory", "Hot Drinks"],
    ["kds.overdueMinutes", 10],
    ["currency.symbol", "Ks"],
    ["payments.enabled", ["cash", "kbzpay", "wavepay"]],
    ["payments.kbzpay.mode", "sandbox"],
    ["payments.wavepay.mode", "sandbox"],
    ["sms.provider", "none"],
    ["notifications.lowStock", true],
    ["notifications.eodSummary", true],
  ];
  for (const [key, value] of settings) {
    await prisma.setting.create({ data: { branchId: branch.id, key, value: JSON.stringify(value) } });
  }

  console.log("Seed complete: branch", branch.id);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
