// api/state.js
// O site chama isso pra buscar os leilões e a lista de banidos que valem
// pra TODO MUNDO (não mais só o que está salvo no navegador de cada um).

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

export default async function handler(req, res) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };

  try {
    const [aRes, bRes, mRes] = await Promise.all([
      fetch(`${base}/rest/v1/auctions?select=*&order=created_at.desc`, { headers }),
      fetch(`${base}/rest/v1/banned?select=*`, { headers }),
      fetch(`${base}/rest/v1/messages?select=*&order=created_at.desc&limit=200`, { headers }),
    ]);
    if (!aRes.ok || !bRes.ok || !mRes.ok) throw new Error("supabase_error");
    const aRows = await aRes.json();
    const bRows = await bRes.json();
    const mRows = await mRes.json();

    res.status(200).json({
      auctions: aRows.map(mapAuction),
      banned: bRows.map((r) => ({ discordId: r.discord_id, label: r.label })),
      messages: mRows
        .map((r) => ({
          id: r.id,
          auctionId: r.auction_id,
          discordId: r.discord_id,
          minecraft: r.minecraft,
          avatar: r.avatar,
          message: r.message,
          createdAt: Number(r.created_at),
        }))
        .reverse(), // volta pra ordem cronológica (mais antiga primeiro)
    });
  } catch (e) {
    res.status(500).json({ error: "Erro ao buscar dados do Supabase." });
  }
}
