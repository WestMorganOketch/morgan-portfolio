import bcrypt from "bcryptjs";
import { stdin, stdout } from "node:process";

function readSecret(prompt) {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
      reject(new Error("Run this command in the VS Code terminal so the password can be entered privately."));
      return;
    }

    stdout.write(prompt);
    let value = "";
    const finish = (error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      const key = chunk.toString();
      if (key === "\u0003") return finish(new Error("Password setup cancelled."));
      if (key === "\r" || key === "\n") return finish();
      if (key === "\u0008" || key === "\u007f") {
        value = value.slice(0, -1);
        return;
      }
      if (key.length === 1 && key >= " ") value += key;
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

try {
  const password = await readSecret("Choose an admin password (at least 14 characters): ");
  if (password.length < 14) throw new Error("Choose a password with at least 14 characters.");
  const confirmation = await readSecret("Confirm the admin password: ");
  if (password !== confirmation) throw new Error("The passwords do not match.");
  stdout.write(`${await bcrypt.hash(password, 12)}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Password hash generation failed.");
  process.exitCode = 1;
}
