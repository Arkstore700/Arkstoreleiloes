// api/discord-login.js
// Chamado quando o usuário clica em "Entrar com Discord".
// Só monta o link de autorização do Discord e redireciona pra lá.

export default function handler(req, res) {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
    response_type: "code",
    scope: "identify", // "identify" já dá nome de usuário + avatar
  });

  res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
}
