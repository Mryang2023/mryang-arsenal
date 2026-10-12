@echo off
rem arsenal-server 本地常驻启动（交给 schtasks，脱离交互式 shell 的进程回收）
cd /d D:\mryang\workspace\2026\arsenal\arsenal-server
set SKIP_COMPILE=1
"C:\Users\Administrator\.workbuddy\binaries\PortableGit\bin\bash.exe" -lc "bash scripts/run.sh > target/run.log 2>&1"
