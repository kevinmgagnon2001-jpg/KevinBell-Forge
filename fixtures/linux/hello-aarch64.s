// Hand-written AArch64 Linux program: prints a greeting and exits 0.
    .globl _start
    .text
_start:
    mov x8, #64             // write
    mov x0, #1              // stdout
    adr x1, msg
    mov x2, #len
    svc #0
    mov x8, #93             // exit
    mov x0, #0
    svc #0
msg: .ascii "Hello from AArch64 Linux, running inside Forge\n"
    .set len, . - msg
