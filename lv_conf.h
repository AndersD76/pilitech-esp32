/**
 * @file lv_conf.h
 * Configuração para LVGL - ESP32 sem suporte a sistemas operacionais
 */

 #if 1 /* Habilite este arquivo */

 #ifndef LV_CONF_H
 #define LV_CONF_H
 
 #include <stdint.h>
 
 /* Desabilitar TODOS os suportes a sistemas operacionais */
 #define LV_USE_OS 0
 
 /* Desabilitar especificamente Windows, FreeRTOS e outros sistemas */
 #define LV_USE_WINDOWS 0
 #define LV_USE_FREERTOS 0
 #define LV_USE_PTHREAD 0
 #define LV_USE_ZEPHYR 0
 #define LV_USE_CUSTOM_OS 0
 
 /*====================
    COLOR SETTINGS
  *====================*/
 
 /* Profundidade de cor: 16 (RGB565) para ESP32 */
 #define LV_COLOR_DEPTH 16
 
 /* Não inverter bytes RGB565 */
 #define LV_COLOR_16_SWAP 0
 
 /*====================
    MEMORY SETTINGS
  *====================*/
 
 /* Tamanho da memória para a biblioteca LVGL */
 #define LV_MEM_CUSTOM 0
 #if LV_MEM_CUSTOM == 0
     #define LV_MEM_SIZE (32U * 1024U)  /* 32kB para ESP32 */
     #define LV_MEM_ATTR
     #define LV_MEM_ADR 0
     #define LV_MEM_AUTO_DEFRAG 1
 #endif
 
 /*====================
    HAL SETTINGS
  *====================*/
 
 /* Período de atualização do display */
 #define LV_DISP_DEF_REFR_PERIOD 30
 
 /* Período de leitura para dispositivos de entrada */
 #define LV_INDEV_DEF_READ_PERIOD 30
 
 /* Usar o millis() do Arduino como fonte de tick */
 #define LV_TICK_CUSTOM 1
 #if LV_TICK_CUSTOM
     #define LV_TICK_CUSTOM_INCLUDE <Arduino.h>
     #define LV_TICK_CUSTOM_SYS_TIME_EXPR (millis())
 #endif
 
 /*====================
   FEATURE CONFIGURATION
  *====================*/
 
 /* Permitir desenhos complexos (sombras, gradientes, cantos arredondados) */
 #define LV_DRAW_COMPLEX 1
 
 /* Tamanho do cache para imagens */
 #define LV_IMG_CACHE_DEF_SIZE 0
 
 /* Usar logs (desativado para economizar memória) */
 #define LV_USE_LOG 0
 
 /*====================
  * FONT USAGE
  *====================*/
 
 /* Habilitar fontes Montserrat necessárias */
 #define LV_FONT_MONTSERRAT_12    1
 #define LV_FONT_MONTSERRAT_14    1
 #define LV_FONT_MONTSERRAT_16    1
 #define LV_FONT_MONTSERRAT_22    0
 
 /* Fonte padrão */
 #define LV_FONT_DEFAULT &lv_font_montserrat_14
 
 /*====================
  * WIDGET USAGE
  *====================*/
 
 /* Habilitar widgets necessários */
 #define LV_USE_ARC        1
 #define LV_USE_BAR        1
 #define LV_USE_BTN        1
 #define LV_USE_BTNMATRIX  0
 #define LV_USE_CANVAS     0
 #define LV_USE_CHECKBOX   0
 #define LV_USE_DROPDOWN   0
 #define LV_USE_IMG        1
 #define LV_USE_LABEL      1
 #define LV_USE_LINE       0
 #define LV_USE_ROLLER     0
 #define LV_USE_SLIDER     0
 #define LV_USE_SWITCH     0
 #define LV_USE_TEXTAREA   0
 
 /*====================
  * THEME USAGE
  *====================*/
 
 /* Habilitar temas */
 #define LV_USE_THEME_DEFAULT 1
 #define LV_THEME_DEFAULT_DARK 0
 #define LV_THEME_DEFAULT_GROW 1
 #define LV_THEME_DEFAULT_TRANSITION_TIME 80
 
 /*====================
  * LAYOUTS
  *====================*/
 
 /* Habilitar layouts flex e grid */
 #define LV_USE_FLEX 1
 #define LV_USE_GRID 0
 
 #endif /*LV_CONF_H*/
 
 #endif /*Enabled*/