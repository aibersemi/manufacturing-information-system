from django.apps import AppConfig


class ProductionConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "backend.production"
    verbose_name = "Production Execution"
