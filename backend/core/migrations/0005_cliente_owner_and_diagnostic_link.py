import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0004_diagnostico'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.RenameField(
            model_name='cliente',
            old_name='data_cadastro',
            new_name='criado_em',
        ),
        migrations.AlterField(
            model_name='cliente',
            name='empresa',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='clientes',
                to='core.empresa',
            ),
        ),
        migrations.AddField(
            model_name='cliente',
            name='atualizado_em',
            field=models.DateTimeField(auto_now=True),
        ),
        migrations.AddField(
            model_name='cliente',
            name='documento',
            field=models.CharField(blank=True, max_length=50),
        ),
        migrations.AddField(
            model_name='cliente',
            name='observacoes',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='cliente',
            name='usuario',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name='clientes',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AlterModelOptions(
            name='cliente',
            options={'ordering': ['nome', 'id']},
        ),
        migrations.AddIndex(
            model_name='cliente',
            index=models.Index(fields=['usuario', 'nome'], name='client_user_name_idx'),
        ),
        migrations.AddField(
            model_name='diagnostico',
            name='cliente',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='diagnosticos',
                to='core.cliente',
            ),
        ),
    ]
