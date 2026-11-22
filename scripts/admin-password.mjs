import { passwordHash } from "../lib/server/config.mjs";

if (!process.stdin.isTTY) {
  console.error("Run this command in an interactive terminal.");
  process.exitCode=1;
} else {
  process.stdout.write("Admin password (input hidden): ");
  process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  process.stdin.resume();
  let value="";
  process.stdin.on("data",async chunk=>{
    if (chunk.includes("\u0003")) process.exit(130);
    if (/[\r\n]/.test(chunk)) {
      value+=chunk.split(/[\r\n]/,1)[0];
      process.stdin.setRawMode(false);
      process.stdin.pause();
      console.log();
      if (value.length<16 || value.length>256) { console.error("Use a password between 16 and 256 characters."); process.exitCode=1; }
      else console.log(await passwordHash(value));
      return;
    }
    if (chunk==="\u007f" || chunk==="\b") value=value.slice(0,-1);
    else if (!chunk.startsWith("\u001b")) value+=chunk;
  });
}
