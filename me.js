// api/me.js
// O site chama isso ao carregar a página pra saber se tem alguém logado.
// Só confirma a sessão se a assinatura bater (ninguém consegue forjar
// um cookie sem saber o SESSION_SECRET, que só fica no servidor).

import crypto from "crypto";

function verify(token) {
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

export default function handler(req, res) {
  const cookieHeader = req.headers.cookie || "";
  const match = cookieHeader.match(/ark_session=([^;]+)/);
  const user = match ? verify(match[1]) : null;

  if (!user) {
    res.status(200).json({ loggedIn: false });
    return;
  }
  res.status(200).json({ loggedIn: true, user });
}
