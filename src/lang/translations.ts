// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

export type SupportedLocale = 'en' | 'ru';

export const TRANSLATIONS: Record<string, Record<SupportedLocale, string>> = {
  torst_about_build_commit: {
    en: 'Commit',
    ru: 'Коммит',
  },
  torst_about_build_date: {
    en: 'Build Date',
    ru: 'Дата сборки',
  },
  torst_about_descr: {
    en: 'Plugin version and build info',
    ru: 'Версия плагина и информация о сборке',
  },
  torst_about_name: {
    en: 'About Plugin',
    ru: 'О плагине',
  },
  torst_about_title: {
    en: 'About Torst',
    ru: 'О Torst',
  },
  torst_about_unknown: {
    en: 'Unknown',
    ru: 'Неизвестно',
  },
  torst_about_version: {
    en: 'Version',
    ru: 'Версия',
  },
  torst_active_auto_badge: {
    en: ' [Active (Auto)]',
    ru: ' [Активный (Авто)]',
  },
  torst_active_badge: {
    en: ' [Active]',
    ru: ' [Активный]',
  },
  torst_add_instance: {
    en: 'Add Instance',
    ru: 'Добавить инстанс',
  },
  torst_add_instance_descr: {
    en: 'Add a new Torst instance to the pool',
    ru: 'Добавить новый инстанс Torst в пул',
  },
  torst_already_saved: {
    en: 'Already in Torst',
    ru: 'Уже в Torst',
  },
  torst_already_saved_descr: {
    en: 'Available in the Torst database',
    ru: 'Доступен в базе Torst',
  },
  torst_auth_bearer_descr: {
    en: 'Sign in with the Torst password',
    ru: 'Вход с паролем Torst',
  },
  torst_auth_mode: {
    en: 'Authentication Mode',
    ru: 'Тип аутентификации',
  },
  torst_auth_none: {
    en: 'None',
    ru: 'Без аутентификации',
  },
  torst_auth_none_descr: {
    en: 'No credentials required',
    ru: 'Учетные данные не требуются',
  },
  torst_auth_tag: {
    en: 'Auth: {mode}',
    ru: 'Аутентификация: {mode}',
  },
  torst_back: {
    en: 'Back',
    ru: 'Назад',
  },
  torst_back_to_instances: {
    en: 'Return to instance list',
    ru: 'Вернуться к списку инстансов',
  },
  torst_back_to_settings: {
    en: 'Return to Torst settings',
    ru: 'Вернуться в настройки Torst',
  },
  torst_btn_start_play: {
    en: 'Start Playback',
    ru: 'Воспроизвести',
  },
  torst_btn_subtitle: {
    en: 'Torrents via Torst',
    ru: 'Торренты через Torst',
  },
  torst_cancel: {
    en: 'Cancel',
    ru: 'Отмена',
  },
  torst_card_file_count: {
    en: 'Files: {count}',
    ru: 'Файлов: {count}',
  },
  torst_change_active: {
    en: 'Change Active Instance',
    ru: 'Изменить активный инстанс',
  },
  torst_change_active_descr: {
    en: 'Choose which instance handles requests',
    ru: 'Выбрать инстанс для обработки запросов',
  },
  torst_choice_torrserver: {
    en: 'TorrServer',
    ru: 'TorrServer',
  },
  torst_choice_torrserver_descr: {
    en: 'Stream via TorrServer',
    ru: 'Воспроизведение через TorrServer',
  },
  torst_confirm_add_name: {
    en: 'Add {name}',
    ru: 'Добавить {name}',
  },
  torst_confirm_add_title: {
    en: 'Add Instance?',
    ru: 'Добавить инстанс?',
  },
  torst_confirm_delete_descr: {
    en: 'This also removes its saved credentials',
    ru: 'Сохраненные учетные данные тоже удалятся',
  },
  torst_confirm_delete_name: {
    en: 'Delete {name}',
    ru: 'Удалить {name}',
  },
  torst_confirm_delete_title: {
    en: 'Delete Instance?',
    ru: 'Удалить инстанс?',
  },
  torst_current_value: {
    en: 'Current: {value}',
    ru: 'Текущее значение: {value}',
  },
  torst_database_search_descr: {
    en: 'Show saved torrents in Lampa global search',
    ru: 'Сохраненные торренты в общем поиске Lampa',
  },
  torst_database_search_name: {
    en: 'Torst Database in Global Search',
    ru: 'База Torst в общем поиске',
  },
  torst_database_search_title: {
    en: 'Torst Database',
    ru: 'База Torst',
  },
  torst_delete_instance: {
    en: 'Delete Instance',
    ru: 'Удалить инстанс',
  },
  torst_delete_instance_descr: {
    en: 'Remove this instance from pool',
    ru: 'Удалить инстанс из пула',
  },
  torst_desc: {
    en: 'Torst client for torrent streaming',
    ru: 'Клиент Torst для стриминга торрентов',
  },
  torst_disable_downloader: {
    en: 'Disable Background Downloader',
    ru: 'Отключить фоновый загрузчик',
  },
  torst_discard_instance: {
    en: 'Discard this instance',
    ru: 'Отменить добавление',
  },
  torst_edit_name: {
    en: 'Edit Name',
    ru: 'Изменить название',
  },
  torst_edit_password: {
    en: 'Edit Password',
    ru: 'Изменить пароль',
  },
  torst_edit_url: {
    en: 'Edit Instance URL',
    ru: 'Изменить URL инстанса',
  },
  torst_empty_conn_error: {
    en: 'Unable to load database torrents: {msg}<br>Please check your instance connection.',
    ru: 'Не удалось загрузить торренты из базы: {msg}<br>Проверьте подключение к инстансу.',
  },
  torst_empty_conn_error_title: {
    en: 'Torst: Connection Error',
    ru: 'Torst: Ошибка подключения',
  },
  torst_empty_db: {
    en: 'No torrents found in Torst database',
    ru: 'В базе Torst нет торрентов',
  },
  torst_empty_no_instances: {
    en: 'No Torst instances are configured.<br>Please add an instance in Settings → Torst → Manage Instance Pool.',
    ru: 'Нет настроенных инстансов Torst.<br>Добавьте инстанс в Настройки → Torst → Управление пулом инстансов.',
  },
  torst_empty_no_instances_title: {
    en: 'Torst: No Instances Configured',
    ru: 'Torst: Инстансы не настроены',
  },
  torst_empty_search: {
    en: 'No saved torrents match “{query}”',
    ru: 'Нет сохраненных торрентов по запросу «{query}»',
  },
  torst_empty_unreachable: {
    en: 'All configured Torst instances are unreachable.<br>Please check instance status in Settings → Torst → Manage Instance Pool.',
    ru: 'Все настроенные инстансы Torst недоступны.<br>Проверьте статус в Настройки → Torst → Управление пулом инстансов.',
  },
  torst_empty_unreachable_title: {
    en: 'Torst: Instances Unreachable',
    ru: 'Torst: Инстансы недоступны',
  },
  torst_enable_downloader: {
    en: 'Enable Background Downloader',
    ru: 'Включить фоновый загрузчик',
  },
  torst_enabled_descr: {
    en: 'Torrent playback and search via Torst',
    ru: 'Просмотр и поиск торрентов через Torst',
  },
  torst_enabled_name: {
    en: 'Enable Torst',
    ru: 'Включить Torst',
  },
  torst_hint_storage_requires_save: {
    en: 'Disk storage requires Save to Database',
    ru: 'Для хранения на диске нужно сохранение в базу',
  },
  torst_instance_url_placeholder: {
    en: 'Instance URL (e.g. http://192.168.1.100:8080)',
    ru: 'URL инстанса (например, http://192.168.1.100:8080)',
  },
  torst_invalid_credentials_noty: {
    en: 'Torst: Saved credentials for {names} could not be read. Please re-enter the password in Settings.',
    ru: 'Torst: Не удалось прочитать сохраненные учетные данные для {names}. Введите пароль заново в Настройках.',
  },
  torst_keep_instance: {
    en: 'Keep this instance',
    ru: 'Оставить инстанс',
  },
  torst_label_persistence: {
    en: 'Database:',
    ru: 'Сохранение в базе:',
  },
  torst_label_storage: {
    en: 'Storage Type:',
    ru: 'Тип хранилища:',
  },
  torst_latency_ms: {
    en: '{latency} ms',
    ru: '{latency}\u00A0мс',
  },
  torst_manage_pool_descr: {
    en: 'Instances, authentication, and latency checks',
    ru: 'Инстансы, аутентификация и проверка задержки',
  },
  torst_manage_pool_name: {
    en: 'Manage Instance Pool',
    ru: 'Управление пулом инстансов',
  },
  torst_manage_providers_descr: {
    en: 'Configure Jackett and Prowlarr providers',
    ru: 'Настройка провайдеров Jackett и Prowlarr',
  },
  torst_manage_providers_name: {
    en: 'Manage Search Providers',
    ru: 'Управление провайдерами поиска',
  },
  torst_menu_delete: {
    en: 'Delete from Torst',
    ru: 'Удалить из Torst',
  },
  torst_menu_delete_descr: {
    en: 'Remove torrent and its downloaded data',
    ru: 'Удалить торрент и скачанные данные',
  },
  torst_menu_switch_disk: {
    en: 'Switch to Disk',
    ru: 'Переключить на диск',
  },
  torst_menu_switch_disk_descr: {
    en: 'Currently stored in RAM',
    ru: 'Сейчас хранится в оперативной памяти',
  },
  torst_menu_switch_ram: {
    en: 'Switch to RAM',
    ru: 'Переключить на оперативную память',
  },
  torst_menu_switch_ram_descr: {
    en: 'Currently stored on disk',
    ru: 'Сейчас хранится на диске',
  },
  torst_noty_added: {
    en: 'Added {name} to pool',
    ru: 'Инстанс {name} добавлен в пул',
  },
  torst_noty_added_db: {
    en: 'Torst: "{title}" added to database!',
    ru: 'Torst: «{title}» добавлен в базу!',
  },
  torst_noty_cannot_delete_only: {
    en: 'Cannot delete the only instance in pool',
    ru: 'Нельзя удалить единственный инстанс в пуле',
  },
  torst_noty_connected: {
    en: 'Connected! Latency: {latency} ms',
    ru: 'Подключено! Задержка: {latency}\u00A0мс',
  },
  torst_noty_delete_failed: {
    en: 'Failed to delete: {msg}',
    ru: 'Не удалось удалить: {msg}',
  },
  torst_noty_deleted: {
    en: 'Deleted {name}',
    ru: 'Инстанс {name} удален',
  },
  torst_noty_deleted_from_tp: {
    en: 'Torrent deleted from Torst',
    ru: 'Торрент удален из Torst',
  },
  torst_noty_downloader_disabled: {
    en: 'Background downloader disabled on {name}',
    ru: 'Фоновый загрузчик отключен на {name}',
  },
  torst_noty_downloader_enabled: {
    en: 'Background downloader enabled on {name}',
    ru: 'Фоновый загрузчик включен на {name}',
  },
  torst_noty_downloader_failed: {
    en: 'Failed to update background downloader: {msg}',
    ru: 'Не удалось переключить фоновый загрузчик: {msg}',
  },
  torst_noty_duplicate_url: {
    en: 'An instance with this URL already exists',
    ru: 'Инстанс с таким URL уже существует',
  },
  torst_noty_error: {
    en: 'Torst: {msg}',
    ru: 'Torst: {msg}',
  },
  torst_noty_failed_connect: {
    en: 'Failed to connect to {url}',
    ru: 'Не удалось подключиться к {url}',
  },
  torst_noty_failover: {
    en: 'Torst: {failed} offline → Switched to {next} ({latency} ms)',
    ru: 'Torst: {failed} недоступен → переключено на {next} ({latency}\u00A0мс)',
  },
  torst_noty_hash_required: {
    en: 'Torst: Valid magnet link or info hash is required',
    ru: 'Torst: Требуется корректная magnet-ссылка или инфо-хеш',
  },
  torst_noty_no_instances: {
    en: 'Add an instance to the pool first',
    ru: 'Сначала добавьте инстанс в пул',
  },
  torst_noty_no_video: {
    en: 'No video files found in torrent',
    ru: 'В торренте не найдены видеофайлы',
  },
  torst_noty_offline_warning: {
    en: 'Warning: Instance is offline or unreachable',
    ru: 'Внимание: инстанс недоступен',
  },
  torst_noty_online: {
    en: 'Instance online! Latency: {latency} ms',
    ru: 'Инстанс доступен! Задержка: {latency}\u00A0мс',
  },
  torst_noty_pinging_all: {
    en: 'Checking all Torst instances...',
    ru: 'Проверка всех инстансов Torst...',
  },
  torst_noty_preload_evicted: {
    en: 'Preload was stopped to free memory',
    ru: 'Предзагрузка остановлена, чтобы освободить память',
  },
  torst_noty_preload_failed: {
    en: 'Preload failed: not enough memory or the torrent stopped receiving data',
    ru: 'Предзагрузка не удалась: не хватило памяти или торрент перестал получать данные',
  },
  torst_noty_preload_rejected: {
    en: 'Torst refused to preload this file',
    ru: 'Torst отказался предзагружать этот файл',
  },
  torst_noty_preload_start_unknown: {
    en: 'Could not confirm preload start. Try again.',
    ru: 'Нет ответа о запуске предзагрузки. Повторите попытку.',
  },
  torst_noty_preload_timeout: {
    en: 'Preload stopped: no data is arriving',
    ru: 'Предзагрузка прервана: данные не поступают',
  },
  torst_noty_preload_unauthorized: {
    en: 'Torst rejected the credentials for {name}. Check them in Settings.',
    ru: 'Torst отклонил учетные данные для {name}. Проверьте их в настройках.',
  },
  torst_noty_save_error: {
    en: 'Torst Save Error: {msg}',
    ru: 'Ошибка сохранения в Torst: {msg}',
  },
  torst_noty_selected_active: {
    en: 'Selected {name} as active instance',
    ru: 'Инстанс {name} выбран активным',
  },
  torst_noty_storage_switch_failed: {
    en: 'Failed to switch storage: {msg}',
    ru: 'Не удалось переключить хранилище: {msg}',
  },
  torst_noty_storage_switched: {
    en: 'Storage switched to {storage}',
    ru: 'Тип хранилища изменен: {storage}',
  },
  torst_noty_testing: {
    en: 'Testing {url}...',
    ru: 'Проверка {url}...',
  },
  torst_noty_url_updated: {
    en: 'Instance URL updated',
    ru: 'URL инстанса обновлен',
  },
  torst_noty_valid_url: {
    en: 'Enter a valid HTTP or HTTPS instance URL',
    ru: 'Укажите корректный HTTP или HTTPS URL инстанса',
  },
  torst_opt_dont_save: {
    en: 'Do Not Save (Temporary)',
    ru: 'Не сохранять (временно)',
  },
  torst_opt_remember: {
    en: "Remember choice (don't ask again)",
    ru: 'Запомнить выбор (больше не спрашивать)',
  },
  torst_opt_save_db: {
    en: 'Save to Database',
    ru: 'Сохранить в базу',
  },
  torst_options_title: {
    en: 'Playback Options',
    ru: 'Параметры воспроизведения',
  },
  torst_play_title: {
    en: 'Play: {title}',
    ru: 'Воспроизведение: {title}',
  },
  torst_play_via: {
    en: 'Play via Torst',
    ru: 'Смотреть через Torst',
  },
  torst_play_via_descr: {
    en: 'Stream via active Torst instance',
    ru: 'Воспроизведение через активный инстанс',
  },
  torst_playback_mode_ask: {
    en: 'Ask Before Play (Torst / TorrServer)',
    ru: 'Спрашивать перед просмотром (Torst / TorrServer)',
  },
  torst_playback_mode_context: {
    en: 'Manual (Context Menu & Button)',
    ru: 'Вручную (кнопка и меню)',
  },
  torst_playback_mode_descr: {
    en: 'Torst or TorrServer when a torrent starts',
    ru: 'Torst или TorrServer при запуске торрента',
  },
  torst_playback_mode_name: {
    en: 'Torrent Playback',
    ru: 'Воспроизведение торрентов',
  },
  torst_playback_mode_torst: {
    en: 'Always Torst',
    ru: 'Всегда Torst',
  },
  torst_pool_auto_mode: {
    en: 'Auto Mode',
    ru: 'Автоматический режим',
  },
  torst_pool_manual_mode: {
    en: 'Manual Mode',
    ru: 'Ручной режим',
  },
  torst_pool_title: {
    en: 'Torst Pool ({mode})',
    ru: 'Пул Torst ({mode})',
  },
  torst_profile_create: {
    en: 'Create Profile',
    ru: 'Создать профиль',
  },
  torst_profile_delete: {
    en: 'Delete Profile',
    ru: 'Удалить профиль',
  },
  torst_profile_delete_confirm: {
    en: 'Delete this profile and all its viewing progress?',
    ru: 'Удалить профиль и весь его прогресс просмотра?',
  },
  torst_profile_instance_title: {
    en: 'Torst Profiles — Select Instance',
    ru: 'Профили Torst — выбор инстанса',
  },
  torst_profile_local: {
    en: 'Local Lampa Progress',
    ru: 'Прогресс только в Lampa',
  },
  torst_profile_name: {
    en: 'Profile Name',
    ru: 'Имя профиля',
  },
  torst_profile_rename: {
    en: 'Rename Profile',
    ru: 'Переименовать профиль',
  },
  torst_profile_required: {
    en: 'Select a Torst profile first',
    ru: 'Сначала выберите профиль Torst',
  },
  torst_profile_use: {
    en: 'Use This Profile',
    ru: 'Выбрать этот профиль',
  },
  torst_profiles_title: {
    en: 'Torst Profiles',
    ru: 'Профили Torst',
  },
  torst_progress_load_error: {
    en: 'Could not load progress from Torst',
    ru: 'Не удалось загрузить прогресс из Torst',
  },
  torst_progress_save_error: {
    en: 'Could not save progress to Torst',
    ru: 'Не удалось сохранить прогресс в Torst',
  },
  torst_provider_add: {
    en: 'Add Provider',
    ru: 'Добавить провайдер',
  },
  torst_provider_add_descr: {
    en: 'Add a Jackett or Prowlarr provider',
    ru: 'Добавить провайдер Jackett или Prowlarr',
  },
  torst_provider_back_to_list: {
    en: 'Return to provider list',
    ru: 'Вернуться к списку провайдеров',
  },
  torst_provider_confirm_delete_descr: {
    en: 'This also removes its saved API key',
    ru: 'Сохраненный API-ключ также будет удален',
  },
  torst_provider_confirm_delete_title: {
    en: 'Delete Provider?',
    ru: 'Удалить провайдер?',
  },
  torst_provider_delete: {
    en: 'Delete Provider',
    ru: 'Удалить провайдер',
  },
  torst_provider_delete_descr: {
    en: 'Remove this provider from the pool',
    ru: 'Удалить провайдер из пула',
  },
  torst_provider_disable: {
    en: 'Disable Provider',
    ru: 'Отключить провайдер',
  },
  torst_provider_disable_descr: {
    en: 'Exclude this provider from search',
    ru: 'Исключить провайдер из поиска',
  },
  torst_provider_edit_api_key: {
    en: 'Edit API Key',
    ru: 'Изменить API-ключ',
  },
  torst_provider_edit_url: {
    en: 'Edit Provider URL',
    ru: 'Изменить URL провайдера',
  },
  torst_provider_enable: {
    en: 'Enable Provider',
    ru: 'Включить провайдер',
  },
  torst_provider_enable_descr: {
    en: 'Include this provider in search',
    ru: 'Включить провайдер в поиск',
  },
  torst_provider_invalid_credentials_noty: {
    en: 'Torst: Saved API keys for {names} could not be read. Please re-enter them in Settings.',
    ru: 'Torst: Не удалось прочитать сохраненные API-ключи для {names}. Введите их заново в Настройках.',
  },
  torst_provider_keep: {
    en: 'Keep this provider',
    ru: 'Оставить этот провайдер',
  },
  torst_provider_noty_added: {
    en: 'Added {name} to pool',
    ru: 'Провайдер {name} добавлен в пул',
  },
  torst_provider_noty_deleted: {
    en: 'Deleted {name}',
    ru: 'Провайдер {name} удален',
  },
  torst_provider_noty_duplicate_url: {
    en: 'A provider with this URL already exists',
    ru: 'Провайдер с таким URL уже существует',
  },
  torst_provider_noty_pinging_all: {
    en: 'Testing all search providers...',
    ru: 'Проверка всех провайдеров поиска...',
  },
  torst_provider_noty_url_updated: {
    en: 'Provider URL updated',
    ru: 'URL провайдера обновлен',
  },
  torst_provider_noty_valid_url: {
    en: 'Enter a valid HTTP or HTTPS provider URL',
    ru: 'Укажите корректный HTTP или HTTPS URL провайдера',
  },
  torst_provider_pool_title: {
    en: 'Torrent Search Providers',
    ru: 'Провайдеры поиска торрентов',
  },
  torst_provider_search_descr: {
    en: 'Results in a separate tab',
    ru: 'Результаты в отдельной вкладке',
  },
  torst_provider_search_name: {
    en: 'Show in Global Search',
    ru: 'Показывать в общем поиске',
  },
  torst_provider_search_title: {
    en: 'Jackett / Prowlarr',
    ru: 'Jackett / Prowlarr',
  },
  torst_provider_switch_type: {
    en: 'Switch Provider Type',
    ru: 'Изменить тип провайдера',
  },
  torst_provider_test_all: {
    en: 'Test All Providers',
    ru: 'Проверить все провайдеры',
  },
  torst_provider_test_all_descr: {
    en: 'Test latency across all providers',
    ru: 'Проверить задержку всех провайдеров',
  },
  torst_provider_url_placeholder: {
    en: 'Provider URL (e.g. http://192.168.1.100:9117)',
    ru: 'URL провайдера (например, http://192.168.1.100:9117)',
  },
  torst_save_to: {
    en: 'Save to Torst',
    ru: 'Сохранить в Torst',
  },
  torst_save_to_db_ask: {
    en: 'Ask Before Play',
    ru: 'Спрашивать перед просмотром',
  },
  torst_save_to_db_descr: {
    en: 'Save torrents to the Torst database',
    ru: 'Сохранять торренты в базе Torst',
  },
  torst_save_to_db_false: {
    en: 'Never',
    ru: 'Никогда',
  },
  torst_save_to_db_name: {
    en: 'Save to Database',
    ru: 'Сохранение в базе',
  },
  torst_save_to_db_true: {
    en: 'Always',
    ru: 'Всегда',
  },
  torst_save_to_descr: {
    en: 'Save torrent to the database for later',
    ru: 'Сохранить в базу для последующего просмотра',
  },
  torst_select_active_title: {
    en: 'Select Active Instance',
    ru: 'Выбор активного инстанса',
  },
  torst_selection_mode_auto: {
    en: 'Auto (Lowest Latency)',
    ru: 'Авто (наименьшая задержка)',
  },
  torst_selection_mode_descr: {
    en: 'Lowest latency or a manually chosen instance',
    ru: 'Выбор по наименьшей задержке или вручную',
  },
  torst_selection_mode_manual: {
    en: 'Manual Selection',
    ru: 'Выбор вручную',
  },
  torst_selection_mode_name: {
    en: 'Instance Selection',
    ru: 'Выбор инстанса',
  },
  torst_settings_name: {
    en: 'Torst',
    ru: 'Torst',
  },
  torst_status_checking: {
    en: 'Checking...',
    ru: 'Проверка...',
  },
  torst_status_disabled: {
    en: 'Disabled',
    ru: 'Отключено',
  },
  torst_status_enabled: {
    en: 'Enabled',
    ru: 'Включено',
  },
  torst_status_offline: {
    en: 'Offline',
    ru: 'Офлайн',
  },
  torst_status_unknown: {
    en: 'Unknown',
    ru: 'Неизвестно',
  },
  torst_storage_type_ask: {
    en: 'Ask Before Play',
    ru: 'Спрашивать перед просмотром',
  },
  torst_storage_type_descr: {
    en: 'Where to keep the torrent during playback',
    ru: 'Место хранения торрента при просмотре',
  },
  torst_storage_type_disk: {
    en: 'Disk',
    ru: 'Диск',
  },
  torst_storage_type_name: {
    en: 'Storage Type',
    ru: 'Тип хранилища',
  },
  torst_storage_type_ram: {
    en: 'RAM',
    ru: 'Оперативная память',
  },
  torst_test_all: {
    en: 'Test All Instances',
    ru: 'Проверить все инстансы',
  },
  torst_test_all_descr: {
    en: 'Test latency across all pool instances',
    ru: 'Проверить задержку всех инстансов в пуле',
  },
  torst_test_conn: {
    en: 'Test Connection',
    ru: 'Проверить подключение',
  },
  torst_test_conn_descr: {
    en: 'Check availability and measure latency',
    ru: 'Проверить доступность и задержку',
  },
  torst_up_next_dismiss: {
    en: 'Remove from Up Next',
    ru: 'Убрать из списка',
  },
  torst_up_next_empty: {
    en: 'Nothing to continue yet',
    ru: 'Пока нечего продолжить',
  },
  torst_up_next_episode: {
    en: 'Next Episode',
    ru: 'Следующая серия',
  },
  torst_up_next_resume: {
    en: 'Resume · {percent}%',
    ru: 'Продолжить · {percent}%',
  },
  torst_up_next_title: {
    en: 'Up Next',
    ru: 'Продолжить просмотр',
  },
  torst_value_none: {
    en: '(none)',
    ru: '(нет)',
  },
};

/**
 * Registers all plugin translations in Lampa.Lang if available.
 */
export function initTranslations(): void {
  if (typeof Lampa !== 'undefined' && Lampa.Lang && typeof Lampa.Lang.add === 'function') {
    Lampa.Lang.add(TRANSLATIONS);
  }
}

/**
 * Translates a given key with optional parameter substitution and English fallback.
 */
export function translate(
  key: string,
  fallback?: string,
  parameters?: Record<string, number | string>
): string {
  let result = fallback ?? key;

  if (typeof Lampa !== 'undefined' && Lampa.Lang && typeof Lampa.Lang.translate === 'function') {
    const translated = Lampa.Lang.translate(key);
    if (translated && translated !== key) {
      result = translated;
    }
  }

  if (parameters) {
    Object.keys(parameters).forEach(param => {
      result = result.replace(new RegExp(`\\{${param}\\}`, 'g'), String(parameters[param]));
    });
  }

  return result;
}
