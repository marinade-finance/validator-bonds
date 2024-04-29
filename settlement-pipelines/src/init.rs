use crate::arguments::GlobalOpts;
use env_logger::{Builder, Env};

pub fn init_log(global_opts: &GlobalOpts) {
    let verbosity = if global_opts.verbose { "debug" } else { "info" };
    let mut builder = Builder::from_env(Env::default().default_filter_or(verbosity));
    builder.init();
}
