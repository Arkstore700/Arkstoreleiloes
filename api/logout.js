// api/logout.js
// Apaga o cookie de sessão e manda o usuário de volta pra página inicial.

export default function handler(req, res) {
  res.setHeader("Set-Cookie", "ark_session=; Path=/; HttpOnly; Max-Age=0");
  res.redirect("/");
}
