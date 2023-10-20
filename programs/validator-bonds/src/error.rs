use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    // TODO: Add error codes here or remove when not needed
    #[msg("Custom error message")]
    CustomError,
}
