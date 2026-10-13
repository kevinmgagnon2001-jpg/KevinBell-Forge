# Hand-written x86-64 Linux program: prints a greeting and exits 0.
    .globl _start
    .text
_start:
    mov $1, %eax            # write
    mov $1, %edi            # stdout
    lea msg(%rip), %rsi
    mov $len, %edx
    syscall
    mov $60, %eax           # exit
    xor %edi, %edi
    syscall
    .section .rodata
msg: .ascii "Hello from x86-64 Linux, running inside Forge\n"
    .set len, . - msg
