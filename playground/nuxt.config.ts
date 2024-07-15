export default defineNuxtConfig({
    css: [
        "~/assets/scss/index.scss"
    ],
    future: {
        compatibilityVersion: 4
    },
    ssr: false,
    modules: [
        "@unocss/nuxt",
        "@vueuse/nuxt"
    ]
});