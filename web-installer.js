function executeCommand(step) {
    switch (step) {
        case 'buildImage':
            alert('Run the following commands in your terminal:\n\n' +
                'git clone https://github.com/chrisguida/mobile-nixos-oneplus-enchilada-template -b cguida/nix-bitcoin\n' +
                'cd mobile-nixos-oneplus-enchilada-template\n' +
                'nix build .#packages.aarch64-linux.oneplus-enchilada-images');
            break;
        case 'unlockBootloader':
            alert('Follow these steps:\n\n1. Enable USB Debugging on your phone.\n' +
                '2. Run `adb devices` to check the connection.\n' +
                '3. Run `fastboot oem unlock` to unlock the bootloader.');
            break;
        case 'installNixOS':
            alert('Flash the boot images with the following commands:\n\n' +
                'result/flash-critical.sh\n' +
                'fastboot flash userdata result/system.img\n' +
                'fastboot erase dtbo_a\n' +
                'fastboot erase dtbo_b\n' +
                'Finally, boot into NixOS and login.');
            break;
        case 'remoteRebuild':
            alert('Run the remote rebuild command:\n\n' +
                'nixos-rebuild --target-host root@nix-enchilada --flake .#oneplus-enchilada switch');
            break;
        default:
            alert('Unknown step.');
    }
}