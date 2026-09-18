// api/discord-callback.js
// O Discord manda o usuário de volta pra cá depois que ele autoriza,
// com um "code" temporário na URL. Aqui a gente troca esse code por um
// token de acesso (isso só pode ser feito no servidor, nunca no navegador,
// porque exige o Client Secret) e busca o nome + avatar do usuário.

import crypto from "crypto";

function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", process.env.SESSION_SECRET)
    .update(data)
    .digest("base64url");
  return `${data}.${sig}`;
}

export default async function handler(req, res) {
  const { code } = req.query;
  if (!code) {
    res.status(400).send("Código de autorização ausente.");
    return;
  }

  try {
    // 1) Troca o code por um access_token
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.DISCORD_REDIRECT_URI,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      res.status(400).send("Não foi possível obter o token do Discord.");
      return;
    }

    // 2) Usa o token pra buscar os dados do usuário
    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const user = await userRes.json();

    const avatarUrl = user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
      : `https://cdn.discordapp.com/embed/avatars/0.png`;

    // 3) Cria um cookie de sessão ASSINADO (não dá pra forjar sem o SESSION_SECRET)
    const session = sign({
      id: user.id,
      username: user.username,
      avatar: avatarUrl,
    });

    res.setHeader(
      "Set-Cookie",
      `ark_session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`
    );
    res.redirect("/"); // volta pra página inicial do site, já logado
  } catch (err) {
    res.status(500).send("Erro ao autenticar com o Discord.");
  }
}
