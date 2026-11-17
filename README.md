# Tableside: deploy on Netlify

This folder is everything the app needs. You do not have to edit any file.

```
public/index.html            the app (what staff open on their phones)
netlify/functions/api.mjs    the server part: saves the menu, orders and PIN
netlify.toml                 tells Netlify where the app and server part are
package.json                 lists the one library the server part uses
```

Orders, the menu and the admin PIN are saved in **Netlify Blobs**, which comes with every Netlify site. There is nothing to switch on and no database to create.

## Important: do not use drag and drop

Netlify's drag-and-drop box only publishes the web page. It does not publish the server part, so the menu, orders and PIN keypad would not work. That is what happened on your first try. Use one of the two options below.

## Option A: GitHub (no commands, recommended)

1. Create a free account at github.com and make a **New repository** (private is fine).
2. On the new repository page choose **uploading an existing file**. Drag in the **contents** of this folder: the `public` folder, the `netlify` folder, `netlify.toml`, `package.json` and `README.md`. Click **Commit changes**.
3. Go to app.netlify.com, choose **Add new site**, then **Import an existing project**, then **GitHub**, and pick your repository.
4. Leave every setting as it is and click **Deploy**. Netlify reads `netlify.toml` and installs what it needs.
5. When the deploy turns green, open the site link on your phone.

To update the app later, replace the files in the repository. Netlify redeploys by itself.

## Option B: Netlify command line

You need Node.js 18 or newer installed.

```
npm install
npm install -g netlify-cli
netlify login
netlify deploy --prod --create-site your-restaurant-name
```

If it asks for a team, pick yours. When it finishes it prints the live address.

## First use

1. Open the site on a phone and tap **Admin**.
2. Enter the starting PIN **123456**.
3. Tap **Change PIN** and set your own 6-digit PIN. It applies on every phone.
4. Edit the menu (categories, items, prices) to match yours.

## Tables

The Order tab opens on a list of tables (Table 1 to Table 6 to start with). Tables with items show the item count and running total, and the waiter's name. Open orders are saved on the server, so every phone sees the same tables. Two waiters should not edit the same table at the same moment, because the last change saved wins.

To change the tables, open **Admin**, unlock, tap **Menu and tables**, and use **Add table**, or tap **Edit** on a table to rename or remove it. A table with an open order cannot be removed until it is checked out. At least one table must remain.

## If the menu looks mixed up

The menu you save is kept on the server and wins over the built-in starting menu. To go back to the built-in The Chatpata Affair menu: open **Admin**, unlock with your PIN, tap **Menu and tables**, scroll to **Starting menu**, tap **Reset**, then confirm. Past orders and sales are not touched.

Waiters use the **Order** tab. Everyone sees the same menu and orders on every phone, and the lists refresh about every 6 seconds.

## What is where

| Tab | What it does |
| --- | --- |
| Order | Pick a table first (6 to start with). Inside it, categories run down the left and you can search for any item. Each table's order is saved, so you can go back to the table list, open another table, and return later. When the table is done, tap View order, tick the box beside every item to confirm it, choose Cash or UPI and check out. Checkout stays locked until every item is ticked, and changing an item's quantity un-ticks it |
| Orders | Every order with table, waiter, items and payment type |
| Sales | Total, average bill, Cash and UPI split, best sellers, and day by day for a range |
| Items | Items ordered, grouped under each category name |
| Admin | Admin only, behind the PIN. Three options: **Menu and tables** (add, rename, remove tables; add, change, delete categories, items and prices), **Manage orders** (delete an order made by mistake, or change it between Cash and UPI) and **Change PIN** |

Orders, Sales and Items share one date range. Use the quick buttons (Today, Yesterday, Last 7 days, This month, Last 30 days) or pick From and To dates. Pick the same date in both boxes for a single day. A range can cover up to 93 days.

## Security notes

- The admin PIN is checked on the server. Menu changes are refused without the right PIN, and 5 wrong tries lock PIN checking for a minute.
- Anyone who has the site link can place orders and view orders and sales. Share the link only with your staff. Netlify's paid plans can add a site-wide password if you want one.
- Orders must be dated today or within a day of today, so old records cannot be added by mistake.

## Where the data lives

In your Netlify dashboard open your site, then **Blobs**, then the `tableside` store. Orders are saved as one small file per order under `orders/YYYY-MM-DD/`.
