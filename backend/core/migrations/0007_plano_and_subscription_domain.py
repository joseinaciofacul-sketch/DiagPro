import django.core.validators
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def associate_legacy_licenses(apps, schema_editor):
    Licenca = apps.get_model('core', 'Licenca')
    for license_record in Licenca.objects.select_related('empresa').filter(usuario__isnull=True):
        company = license_record.empresa
        user_id = getattr(company, 'usuario_id', None) if company else None
        if user_id and not Licenca.objects.filter(usuario_id=user_id).exclude(pk=license_record.pk).exists():
            license_record.usuario_id = user_id
            license_record.save(update_fields=['usuario'])


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0006_empresa_usuario_alter_empresa_cnpj_and_more'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='Plano',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('nome', models.CharField(max_length=120)),
                ('slug', models.SlugField(max_length=120, unique=True)),
                ('descricao', models.TextField(blank=True)),
                ('ativo', models.BooleanField(db_index=True, default=True)),
                ('preco_mensal', models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True, validators=[django.core.validators.MinValueValidator(0)])),
                ('moeda', models.CharField(blank=True, max_length=3)),
                ('max_usuarios', models.PositiveIntegerField(blank=True, null=True, validators=[django.core.validators.MinValueValidator(1)])),
                ('max_dispositivos', models.PositiveIntegerField(blank=True, null=True, validators=[django.core.validators.MinValueValidator(1)])),
                ('max_diagnosticos_mes', models.PositiveIntegerField(blank=True, null=True, validators=[django.core.validators.MinValueValidator(1)])),
                ('scanner_completo', models.BooleanField(default=False)),
                ('remediacao', models.BooleanField(default=False)),
                ('relatorios', models.BooleanField(default=False)),
                ('visao_gerencial', models.BooleanField(default=False)),
            ],
            options={'ordering': ['nome', 'id']},
        ),
        migrations.RenameField(model_name='licenca', old_name='ativa', new_name='ativa_legado'),
        migrations.RenameField(model_name='licenca', old_name='data_expiracao', new_name='fim'),
        migrations.RenameField(model_name='licenca', old_name='data_inicio', new_name='inicio'),
        migrations.RenameField(model_name='licenca', old_name='plano', new_name='ciclo_legado'),
        migrations.AlterField(
            model_name='licenca',
            name='empresa',
            field=models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='licenca', to='core.empresa'),
        ),
        migrations.AddField(
            model_name='licenca',
            name='usuario',
            field=models.OneToOneField(null=True, on_delete=django.db.models.deletion.CASCADE, related_name='licenca', to=settings.AUTH_USER_MODEL),
        ),
        migrations.AddField(
            model_name='licenca',
            name='plano',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, related_name='licencas', to='core.plano'),
        ),
        migrations.AddField(
            model_name='licenca',
            name='status',
            field=models.CharField(choices=[('trial', 'Período de teste'), ('active', 'Ativa'), ('past_due', 'Pagamento pendente'), ('canceled', 'Cancelada'), ('expired', 'Expirada')], max_length=20, null=True),
        ),
        migrations.AddField(model_name='licenca', name='renovacao_automatica', field=models.BooleanField(default=False)),
        migrations.AddField(model_name='licenca', name='provider', field=models.CharField(blank=True, max_length=60)),
        migrations.AddField(model_name='licenca', name='external_subscription_id', field=models.CharField(blank=True, max_length=180)),
        migrations.AddField(model_name='licenca', name='atualizado_em', field=models.DateTimeField(auto_now=True, null=True)),
        migrations.RunPython(associate_legacy_licenses, migrations.RunPython.noop),
    ]
