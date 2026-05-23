//! Mark NSMenuItem icons as template images so macOS inverts them along with
//! the title text on hover/highlight. muda creates NSImages via `initWithData:`
//! and never calls `setTemplate:`, so without this fix the icon stays its
//! authored color while the title flips to the highlight foreground color.

#[cfg(target_os = "macos")]
pub fn install() {
    macos::install();
}

#[cfg(not(target_os = "macos"))]
pub fn install() {}

#[cfg(target_os = "macos")]
mod macos {
    use objc::runtime::{
        self, class_getInstanceMethod, method_getImplementation, method_setImplementation,
        object_getClass, Class, Imp, Object, Sel, BOOL, YES,
    };
    use std::sync::Once;

    type SetImageFn = unsafe extern "C" fn(*mut Object, Sel, *mut Object);
    type SetTemplateFn = unsafe extern "C" fn(*mut Object, Sel, BOOL);

    static mut ORIGINAL_SET_IMAGE: Option<SetImageFn> = None;

    unsafe extern "C" fn set_image_template(this: *mut Object, sel: Sel, image: *mut Object) {
        if !image.is_null() {
            let set_template_sel = Sel::register("setTemplate:");
            // Resolve setTemplate: on the image's class and call it directly
            // (avoids pulling in objc's msg_send! macro, which trips this
            // crate's clippy config on the cargo-clippy cfg).
            let image_cls: *const Class = object_getClass(image);
            let method = class_getInstanceMethod(image_cls, set_template_sel);
            if !method.is_null() {
                let imp = method_getImplementation(method);
                let func: SetTemplateFn = std::mem::transmute(imp);
                func(image, set_template_sel, YES);
            }
        }
        if let Some(original) = ORIGINAL_SET_IMAGE {
            original(this, sel, image);
        }
    }

    pub fn install() {
        static ONCE: Once = Once::new();
        ONCE.call_once(|| unsafe {
            let Some(cls) = runtime::Class::get("NSMenuItem") else {
                tracing::warn!("NSMenuItem class not found; template swizzle skipped");
                return;
            };
            let sel = Sel::register("setImage:");
            let method = class_getInstanceMethod(cls, sel);
            if method.is_null() {
                tracing::warn!("NSMenuItem setImage: method not found; template swizzle skipped");
                return;
            }
            let original = method_getImplementation(method);
            ORIGINAL_SET_IMAGE = Some(std::mem::transmute::<Imp, SetImageFn>(original));
            let replacement: SetImageFn = set_image_template;
            // `method_setImplementation` takes `*mut Method`; the runtime cast is sound.
            method_setImplementation(
                method as *mut _,
                std::mem::transmute::<SetImageFn, Imp>(replacement),
            );
        });
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    #[test]
    fn install_is_idempotent_and_does_not_crash() {
        super::install();
        super::install();
    }
}
