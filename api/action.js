// api/action.js
// Toda ação que muda dados (dar lance, criar/encerrar/excluir leilão,
// banir/desbanir, remover lance) passa por aqui e é salva no Supabase,
// então fica igual pra todo mundo que acessa o site.
//
// Quem é o "dono" do lance é sempre lido do cookie de sessão assinado
// (o mesmo que o /api/me usa) — ninguém consegue forjar um lance em nome
// de outra pessoa só mudando o que o navegador envia.
// Ações de admin exigem o código secreto, conferido aqui no servidor.

import crypto from "crypto";

function verifySession(token) {
  if (!token || !token.includes(".")) return null;
  const [data, sig] = token.split(".");
  const expected = crypto
    .createHmac("sha256", process.env.SESSION_SECRET)
    .update(data)
    .digest("base64url");
  if (sig !== expected) return null;
  try {
    return JSON.parse(Buffer.from(data, "base64url").toString());
  } catch {
    return null;
  }
}

function mapAuction(r) {
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    desc: r.description || "",
    minBid: Number(r.min_bid),
    image: r.image,
    ivImage: r.iv_image,
    bids: r.bids || [],
    createdAt: Number(r.created_at),
    endsAt: Number(r.ends_at),
    status: r.status,
    extended: !!r.extended,
  };
}

const MIN_INCREMENT = 100000;
const ANTI_SNIPE_WINDOW = 5 * 60000;
const ANTI_SNIPE_EXTEND = 5 * 60000;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

  const cookieHeader = req.headers.cookie || "";
  const cookieMatch = cookieHeader.match(/ark_session=([^;]+)/);
  const sessionUser = cookieMatch ? verifySession(cookieMatch[1]) : null;

  const body = req.body || {};
  const { type } = body;
  const isAdmin = body.adminCode && body.adminCode === process.env.ADMIN_CODE;

  try {
    if (type === "bid") {
      if (!sessionUser) return res.status(401).json({ error: "not_logged_in" });
      const { auctionId, minecraft, value } = body;
      if (!minecraft) return res.status(400).json({ error: "no_minecraft_name" });

      const bannedRes = await fetch(
        `${base}/rest/v1/banned?discord_id=eq.${encodeURIComponent(sessionUser.id)}&select=discord_id`,
        { headers }
      );
      const bannedRows = await bannedRes.json();
      if (bannedRows.length) return res.status(403).json({ error: "banned" });

      const aRes = await fetch(`${base}/rest/v1/auctions?id=eq.${encodeURIComponent(auctionId)}&select=*`, { headers });
      const aRows = await aRes.json();
      const a = aRows[0];
      if (!a) return res.status(404).json({ error: "not_found" });
      if (a.status !== "active" || Date.now() >= Number(a.ends_at)) {
        return res.status(400).json({ error: "ended" });
      }

      const bids = a.bids || [];
      const hasBids = bids.length > 0;
      const currentHigh = hasBids ? bids[0].value : null;
      const minAllowed = hasBids ? currentHigh + MIN_INCREMENT : Number(a.min_bid);
      const val = Number(value);
      if (!val || val < minAllowed) {
        return res.status(400).json({ error: "bid_too_low", minAllowed, hasBids });
      }

      bids.unshift({
        minecraft,
        discord: sessionUser.username,
        discordId: sessionUser.id,
        value: val,
        time: Date.now(),
      });

      let endsAt = Number(a.ends_at);
      let extended = a.extended;
      if (endsAt - Date.now() <= ANTI_SNIPE_WINDOW) {
        endsAt = Date.now() + ANTI_SNIPE_EXTEND;
        extended = true;
      }

      await fetch(`${base}/rest/v1/auctions?id=eq.${encodeURIComponent(auctionId)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ bids, ends_at: endsAt, extended }),
      });
    } else if (type === "create") {
      if (!isAdmin) return res.status(403).json({ error: "not_admin" });
      const { auction } = body;
      if (!auction || !auction.name || !auction.minBid) {
        return res.status(400).json({ error: "invalid_auction" });
      }
      const now = Date.now();
      const row = {
        id: "a_" + now + "_" + Math.floor(Math.random() * 1000),
        type: auction.type,
        name: auction.name,
        description: auction.desc || "",
        min_bid: auction.minBid,
        image: auction.image || null,
        iv_image: auction.ivImage || null,
        bids: [],
        created_at: now,
        ends_at: now + Number(auction.durMinutes) * 60000,
        status: "active",
        extended: false,
      };
      await fetch(`${base}/rest/v1/auctions`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify([row]),
      });
    } else if (type === "finalize") {
      if (!isAdmin) return res.status(403).json({ error: "not_admin" });
      await fetch(`${base}/rest/v1/auctions?id=eq.${encodeURIComponent(body.auctionId)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "ended", ends_at: Date.now() }),
      });
    } else if (type === "delete") {
      if (!isAdmin) return res.status(403).json({ error: "not_admin" });
      await fetch(`${base}/rest/v1/auctions?id=eq.${encodeURIComponent(body.auctionId)}`, {
        method: "DELETE",
        headers,
      });
    } else if (type === "removeBid") {
      if (!isAdmin) return res.status(403).json({ error: "not_admin" });
      const { auctionId, bidIndex } = body;
      const aRes = await fetch(`${base}/rest/v1/auctions?id=eq.${encodeURIComponent(auctionId)}&select=bids`, { headers });
      const aRows = await aRes.json();
      const a = aRows[0];
      if (!a) return res.status(404).json({ error: "not_found" });
      const bids = a.bids || [];
      bids.splice(bidIndex, 1);
      await fetch(`${base}/rest/v1/auctions?id=eq.${encodeURIComponent(auctionId)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ bids }),
      });
    } else if (type === "ban") {
      if (!isAdmin) return res.status(403).json({ error: "not_admin" });
      const { discordId, label } = body;
      await fetch(`${base}/rest/v1/banned`, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=ignore-duplicates" },
        body: JSON.stringify([{ discord_id: discordId, label }]),
      });
    } else if (type === "unban") {
      if (!isAdmin) return res.status(403).json({ error: "not_admin" });
      await fetch(`${base}/rest/v1/banned?discord_id=eq.${encodeURIComponent(body.discordId)}`, {
        method: "DELETE",
        headers,
      });
    } else {
      return res.status(400).json({ error: "unknown_type" });
    }

    // devolve o estado já atualizado, pra sincronizar na hora sem esperar o próximo polling
    const [aRes2, bRes2] = await Promise.all([
      fetch(`${base}/rest/v1/auctions?select=*&order=created_at.desc`, { headers }),
      fetch(`${base}/rest/v1/banned?select=*`, { headers }),
    ]);
    const aRows2 = await aRes2.json();
    const bRows2 = await bRes2.json();
    res.status(200).json({
      ok: true,
      auctions: aRows2.map(mapAuction),
      banned: bRows2.map((r) => ({ discordId: r.discord_id, label: r.label })),
    });
  } catch (e) {
    res.status(500).json({ error: "server_error", detail: String(e && e.message || e) });
  }
}
