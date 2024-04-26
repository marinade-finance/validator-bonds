use anchor_client::{DynSigner, RequestBuilder};
use anyhow::anyhow;
use log::error;
use solana_transaction_builder::TransactionBuilder;
use std::rc::Rc;

pub fn add_instructions_to_builder_from_anchor(
    transaction_builder: &mut TransactionBuilder,
    request_builder: &RequestBuilder<Rc<DynSigner>>,
) -> anyhow::Result<()> {
    let instructions = request_builder.instructions().map_err(|e| {
        error!(
            "add_instructions_from_anchor_builder: error building instructions: {:?}",
            e
        );
        anyhow!(e)
    })?;
    transaction_builder.add_instructions(instructions)?;
    transaction_builder.finish_instruction_pack();
    Ok(())
}
