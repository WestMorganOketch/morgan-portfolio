import { randomBytes, scryptSync } from "node:crypto";

function readHiddenPassword() {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
      reject(new Error("Run this command in an interactive terminal so the password is not echoed."));
      return;
    }

    let password = "";
    const cleanup = () => {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Password hashing was cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(password);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          password = Array.from(password).slice(0, -1).join("");
        } else if (character >= " ") {
          password += character;
        }
      }
    };

    process.stdout.write("Admin password (input hidden): ");
    process.stdin.setRawMode(true);
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

try {
  const password = await readHiddenPassword();
  if (Array.from(password).length < 12 || Buffer.byteLength(password, "utf8") > 1024) {
    throw new Error("Use an admin password of at least 12 characters and no more than 1024 UTF-8 bytes.");
  }
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  console.log(`ADMIN_PASSWORD_HASH=scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Could not hash the admin password.");
  process.exitCode = 1;
}
