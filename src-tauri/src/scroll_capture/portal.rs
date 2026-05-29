#[cfg(target_os = "linux")]
mod linux {
    use super::super::mapping::PortalStreamInfo;
    use anyhow::{Context, Result};
    use ashpd::{
        desktop::{
            screencast::{CursorMode, PersistMode, Screencast, SourceType},
            Session,
        },
        WindowIdentifier,
    };
    use std::os::fd::OwnedFd;

    pub(crate) struct PortalScreenCastSession {
        pub streams: Vec<PortalStreamInfo>,
        pub remote_fd: OwnedFd,
        pub restore_token: Option<String>,
        _screencast: Screencast<'static>,
        _session: Session<'static>,
    }

    pub(crate) async fn start_monitor_screencast(
        restore_token: Option<String>,
    ) -> Result<PortalScreenCastSession> {
        let proxy: Screencast<'static> = Screencast::new()
            .await
            .context("wayland screencast portal is unavailable")?;
        let session = proxy
            .create_session()
            .await
            .context("failed to create wayland screencast session")?;

        proxy
            .select_sources(
                &session,
                CursorMode::Hidden,
                SourceType::Monitor.into(),
                true,
                restore_token.as_deref(),
                PersistMode::ExplicitlyRevoked,
            )
            .await
            .context("failed to select wayland screencast sources")?
            .response()
            .context("wayland screencast permission was denied")?;

        let identifier = WindowIdentifier::default();
        let response = proxy
            .start(&session, &identifier)
            .await
            .context("failed to start wayland screencast")?
            .response()
            .context("wayland screencast permission was denied")?;
        let streams = response
            .streams()
            .iter()
            .map(|stream| PortalStreamInfo {
                node_id: stream.pipe_wire_node_id(),
                position: stream.position(),
                size: stream.size(),
                source_type_monitor: stream.source_type() == Some(SourceType::Monitor),
            })
            .collect::<Vec<_>>();
        let remote_fd = proxy
            .open_pipe_wire_remote(&session)
            .await
            .context("failed to open pipewire remote for wayland screencast")?;

        Ok(PortalScreenCastSession {
            streams,
            remote_fd,
            restore_token: response.restore_token().map(str::to_string),
            _screencast: proxy,
            _session: session,
        })
    }

    #[cfg(test)]
    mod tests {
        #[test]
        fn portal_wrapper_uses_monitor_screencast() {
            let source = include_str!("portal.rs");
            let production = source
                .split("#[cfg(test)]")
                .next()
                .expect("portal source should contain production section");

            assert!(production.contains("SourceType::Monitor"));
            assert!(production.contains("CursorMode::Hidden"));
            assert!(production.contains("open_pipe_wire_remote"));
            assert!(production.contains("restore_token"));
        }
    }
}

#[cfg(target_os = "linux")]
pub(crate) use linux::*;
