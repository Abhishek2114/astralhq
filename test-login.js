const https = require("https");
const data = JSON.stringify({
  email: "abhishek.singh23@ethara.ai",
  password: "Admin123!",
});
const req = https.request(
  {
    hostname: "astralhq.vercel.app",
    path: "/api/auth/login",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": data.length,
    },
  },
  (res) => {
    let body = "";
    res.on("data", (c) => (body += c));
    res.on("end", () => {
      console.log("STATUS:", res.statusCode);
      console.log("BODY:", body);
    });
  }
);
req.write(data);
req.end();
