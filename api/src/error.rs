use warp::reject::Reject;

pub(crate) struct CustomError {
    pub message: String,
}

impl Reject for CustomError {}

impl std::fmt::Debug for CustomError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "CustomError: {}", self.message)
    }
}
