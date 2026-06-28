mod pipeline;
mod utils;

use anyhow::Result;
use clap::Parser;
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(
    name = "dvpl-pipeline",
    version,
    about = "Copy → decrypt dvpl → optional encrypt back"
)]
struct Cli {
    #[arg(long, value_name = "PATH", help = "Input directory containing files to process")]
    input: PathBuf,

    #[arg(long, value_name = "PATH", default_value = "original", help = "Folder to copy input into")]
    original_dir: PathBuf,

    #[arg(long, value_name = "PATH", default_value = "decrypted", help = "Folder to write decrypted output into")]
    decrypted_dir: PathBuf,

    #[arg(long, default_value_t = false, help = "After decrypting, encrypt plaintext files back to .dvpl")]
    encrypt_back: bool,

    #[arg(long, default_value_t = false, help = "Delete source .dvpl files after decrypt")]
    delete_dvpl_after_decrypt: bool,

    #[arg(long, default_value_t = false, help = "Delete plaintext files after encrypt-back")]
    delete_plain_after_encrypt_back: bool,
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    pipeline::copy_tree_recursive(&cli.input, &cli.original_dir)?;
    pipeline::decrypt_tree_recursive(
        &cli.original_dir,
        &cli.decrypted_dir,
        pipeline::DecryptOptions {
            delete_dvpl_after_decrypt: cli.delete_dvpl_after_decrypt,
        },
    )?;

    if cli.encrypt_back {
        pipeline::encrypt_back_tree_recursive(
            &cli.decrypted_dir,
            pipeline::EncryptBackOptions {
                delete_plain_after_encrypt_back: cli.delete_plain_after_encrypt_back,
            },
        )?;
    }

    Ok(())
}
